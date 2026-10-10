# QR scanner regression photos

Eight photos from the QR code benchmark that Peter Abeles assembled for
[BoofCV](https://boofcv.org/index.php?title=Performance:QrCode)
([qrcodes_v3.zip](https://boofcv.org/notwiki/regression/fiducial/qrcodes_v3.zip)).
The dataset is published without a stated licence; these are kept here only
as test inputs, with credit to its author, and will be removed on request.

Each was downscaled to a 1280 px long edge and re-encoded as grayscale JPEG
(EXIF dropped, so pixels stay in the raw orientation BoofCV's labels use).
`manifest.json` records the source file, why it was picked, the payloads it
must decode to, which decoder reads it today, and the hand-labelled corners
of every code, scaled to the stored size.

| File | Category | Read by |
|---|---|---|
| `blurred-042.jpg` | motion blur | ZXing |
| `curved-035.jpg` | curved surface | ZXing |
| `high_version-026.jpg` | dense high version | ZXing |
| `rotations-022.jpg` | three codes, three rotations | ZXing |
| `glare-045.jpg` | glare | WeChat fallback |
| `damaged-009.jpg` | physical damage | WeChat fallback |
| `glare-024.jpg` | glare | WeChat retry at 1024 px |
| `glare-036.jpg` | glare, small code | WeChat retry at 512 px |

jsQR, the scanner's first decoder, reads none of the first six at this size.
