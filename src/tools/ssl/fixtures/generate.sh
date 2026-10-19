#!/bin/sh
# Regenerates the THROWAWAY test keys, CSRs and certificates in this folder.
# They exist only for keys.test.ts; none was ever used for anything else.
# Needs OpenSSL 3 (OPENSSL=/path/to/openssl) and OpenSSH's ssh-keygen.
set -eu
cd "$(dirname "$0")"
O=${OPENSSL:-openssl}
rm -f test-*
SUBJ='/CN=test.example/O=Test Fixture'
EXT='subjectAltName=DNS:test.example,DNS:*.test.example,IP:192.0.2.7'

# RSA 2048: PKCS#8, PKCS#1, SPKI, PKCS#1 public, encrypted forms
$O genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out test-rsa.pkcs8.pem
$O rsa -in test-rsa.pkcs8.pem -traditional -out test-rsa.pkcs1.pem
$O pkey -in test-rsa.pkcs8.pem -pubout -out test-rsa.spki.pem
$O rsa -in test-rsa.pkcs8.pem -RSAPublicKey_out -out test-rsa.pkcs1-public.pem
$O pkcs8 -topk8 -in test-rsa.pkcs8.pem -v2 aes-256-cbc -v2prf hmacWithSHA256 -iter 4096 -passout pass:test-only -out test-rsa.encrypted-pbkdf2.pem
$O pkcs8 -topk8 -in test-rsa.pkcs8.pem -scrypt -passout pass:test-only -out test-rsa.encrypted-scrypt.pem
$O rsa -in test-rsa.pkcs8.pem -traditional -aes128 -passout pass:test-only -out test-rsa.legacy-encrypted.pem
$O req -new -key test-rsa.pkcs8.pem -subj "$SUBJ" -addext "$EXT" -addext 'keyUsage=critical,digitalSignature,keyEncipherment' -addext 'extendedKeyUsage=serverAuth' -out test-rsa.csr.pem
$O req -new -key test-rsa.pkcs8.pem -subj "$SUBJ" -sigopt rsa_padding_mode:pss -sigopt rsa_pss_saltlen:32 -sha256 -out test-rsa-pss.csr.pem
$O req -x509 -key test-rsa.pkcs8.pem -subj "$SUBJ" -addext "$EXT" -days 3650 -out test-rsa.cert.pem

# EC P-256 (SEC1 with and without the public point, PKCS#8), P-384
$O genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256 -out test-p256.pkcs8.pem
$O ec -in test-p256.pkcs8.pem -out test-p256.sec1.pem
$O ec -in test-p256.pkcs8.pem -no_public -out test-p256.sec1-nopub.pem
$O pkey -in test-p256.pkcs8.pem -pubout -out test-p256.spki.pem
$O req -new -key test-p256.pkcs8.pem -subj "$SUBJ" -addext "$EXT" -out test-p256.csr.pem
$O req -x509 -key test-p256.pkcs8.pem -subj "$SUBJ" -addext "$EXT" -days 3650 -out test-p256.cert.pem
$O genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-384 -out test-p384.pkcs8.pem

# Ed25519 and X25519
$O genpkey -algorithm ED25519 -out test-ed25519.pkcs8.pem
$O pkey -in test-ed25519.pkcs8.pem -pubout -out test-ed25519.spki.pem
$O req -new -key test-ed25519.pkcs8.pem -subj "$SUBJ" -addext "$EXT" -out test-ed25519.csr.pem
$O genpkey -algorithm X25519 -out test-x25519.pkcs8.pem

# expected SPKI pins: base64(SHA-256(SubjectPublicKeyInfo DER))
for k in rsa p256 p384 ed25519 x25519; do
  printf '%s %s\n' "$k" "$($O pkey -in test-$k.pkcs8.pem -pubout -outform DER | $O dgst -sha256 -binary | $O base64)"
done > test-pins.txt

# OpenSSH: unencrypted and passphrase-protected private keys, public lines
ssh-keygen -q -t ed25519 -N '' -C test-key -f test-ssh-ed25519
ssh-keygen -q -t ed25519 -N test-only -a 16 -C test-key -f test-ssh-ed25519-encrypted
ssh-keygen -q -t rsa -b 2048 -N '' -C test-key -f test-ssh-rsa
ssh-keygen -q -t ecdsa -b 256 -N '' -C test-key -f test-ssh-ecdsa
# ssh-keygen writes user@host into the RFC 4716 comment; keep fixtures anonymous
ssh-keygen -e -f test-ssh-ed25519.pub | sed 's/^Comment: .*/Comment: "test-key, a long comment that \\\
continues on a second line"/' > test-ssh-ed25519.rfc4716.pub
# the OpenSSL RSA key as an OpenSSH public line, to match across formats
chmod 600 test-rsa.pkcs1.pem
ssh-keygen -y -f test-rsa.pkcs1.pem | sed 's/$/ test-key/' > test-rsa.ssh.pub
for k in test-ssh-ed25519 test-ssh-ed25519-encrypted test-ssh-rsa test-ssh-ecdsa test-rsa.ssh; do
  printf '%s %s %s\n' "$k" "$(ssh-keygen -l -E sha256 -f $k.pub | cut -d' ' -f2)" "$(ssh-keygen -l -E md5 -f $k.pub | cut -d' ' -f2)"
done > test-ssh-fingerprints.txt
for f in test-ssh-ed25519 test-ssh-ed25519-encrypted test-ssh-rsa test-ssh-ecdsa; do mv "$f" "$f.key"; done
