import type { Format } from './types'

/** One small example per format, written by hand to show off what each decoder reports. */
export const samples: Record<Format, { hex: string; about: string }> = {
  protobuf: {
    about: 'a Person: text, a varint, packed numbers, a nested message, zigzag and a double',
    hex: [
      '0a 0c 41 64 61 20 4c 6f 76 65 6c 61 63 65', // 1: "Ada Lovelace"
      '10 97 0e', // 2: 1815
      '1a 06 03 8e 02 9e a7 05', // 3: packed [3, 270, 86942]
      '22 0d 0a 06 4c 6f 6e 64 6f 6e 15 00 00 4e 42', // 4: { 1: "London", 2: 51.5f }
      '28 53', // 5: sint32 -42
      '31 6e 86 1b f0 f9 21 09 40', // 6: 3.14159
    ].join('\n'),
  },
  cbor: {
    about: 'a map with an epoch date, a bignum, a float16 and a decimal fraction — keys deliberately unsorted',
    hex: [
      'a6',
      '64 6e616d65 63 416461', // "name": "Ada"
      '64 7365656e c1 1a 6553f100', // "seen": 1(1700000000)
      '64 74616773 82 64 6d617468 64 706f6574', // "tags": ["math", "poet"]
      '63 626967 c2 49 010000000000000000', // "big": 2(h'01…')
      '64 68616c66 f9 3e00', // "half": 1.5
      '65 7072696365 c4 82 21 19 07cf', // "price": 4([-2, 1999])
    ].join('\n'),
  },
  msgpack: {
    about: 'a map with a timestamp ext, binary, a float 64 and an array',
    hex: [
      '86',
      'a7 636f6d70616374 c3', // "compact": true
      'a6 736368656d61 00', // "schema": 0
      'a2 6174 d6 ff 6553f100', // "at": timestamp 32
      'a3 62696e c4 04 deadbeef', // "bin": bin 8
      'a2 7069 cb 400921f9f01b866e', // "pi": 3.14159
      'a4 6c697374 93 01 ff cd 012c', // "list": [1, -1, 300]
    ].join('\n'),
  },
}

export const sampleProto = `syntax = "proto3";

message Person {
  string name = 1;
  int32 born = 2;
  repeated int32 lucky = 3;
  Place home = 4;
  sint32 offset = 5;
  double ratio = 6;
}

message Place {
  string city = 1;
  float lat = 2;
}
`
