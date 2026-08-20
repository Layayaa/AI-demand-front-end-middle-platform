#!/usr/bin/env python3
"""Extract a zip whose entry names are GBK-encoded (Chinese Windows archives).

macOS `unzip` mangles such names and Python's zipfile loses bytes, so we parse
the central directory ourselves to recover the raw filename bytes, decode them
(GBK with fallbacks), then extract with zipfile. The Windows venv (env/) is skipped.
"""
import os
import struct
import sys
import zipfile

ZIP_PATH = sys.argv[1]
DEST = sys.argv[2]
PREFIX = "Requirements_Analysis_Automation-master-8dbe0f39275006deb7ab3e11f19875263cd78777"
SKIP_PREFIX = PREFIX + "/platform/backend/env/"


def find_eocd(data: bytes) -> int:
    """Return offset of End-of-Central-Directory record."""
    tail = data[-22 - 65535:]
    pos = tail.rfind(b"PK\x05\x06")
    if pos < 0:
        raise RuntimeError("EOCD not found")
    return len(data) - len(tail) + pos


def parse_central_directory(data: bytes, eocd: int) -> list[dict]:
    total_entries = struct.unpack_from("<H", data, eocd + 10)[0]
    cd_offset = struct.unpack_from("<I", data, eocd + 16)[0]
    entries = []
    pos = cd_offset
    for _ in range(total_entries):
        if data[pos:pos + 4] != b"PK\x01\x02":
            raise RuntimeError(f"bad central directory signature at {pos}")
        flags = struct.unpack_from("<H", data, pos + 8)[0]
        name_len = struct.unpack_from("<H", data, pos + 28)[0]
        extra_len = struct.unpack_from("<H", data, pos + 30)[0]
        comment_len = struct.unpack_from("<H", data, pos + 32)[0]
        local_header_offset = struct.unpack_from("<I", data, pos + 42)[0]
        raw_name = data[pos + 46: pos + 46 + name_len]
        entries.append({
            "flags": flags,
            "raw_name": raw_name,
            "local_header_offset": local_header_offset,
        })
        pos += 46 + name_len + extra_len + comment_len
    return entries


def decode_name(raw: bytes, flags: int) -> str:
    if flags & 0x800:
        return raw.decode("utf-8", errors="replace")
    for enc in ("gbk", "cp437", "latin-1"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", errors="replace")


def main():
    with open(ZIP_PATH, "rb") as fh:
        data = fh.read()
    eocd = find_eocd(data)
    entries = parse_central_directory(data, eocd)
    print(f"central directory: {len(entries)} entries", flush=True)

    total = 0
    with zipfile.ZipFile(ZIP_PATH) as zf:
        infos = zf.infolist()
        if len(infos) != len(entries):
            raise RuntimeError("infolist/cd count mismatch")
        for info, cd in zip(infos, entries):
            name = decode_name(cd["raw_name"], cd["flags"])
            info.filename = name  # rewrite with correctly decoded name
            if name.startswith(SKIP_PREFIX):
                continue
            target = os.path.join(DEST, name)
            if info.is_dir():
                os.makedirs(target, exist_ok=True)
                continue
            os.makedirs(os.path.dirname(target), exist_ok=True)
            with zf.open(info) as src, open(target, "wb") as dst:
                while True:
                    chunk = src.read(1024 * 1024)
                    if not chunk:
                        break
                    dst.write(chunk)
            total += 1
            if total % 500 == 0:
                print(f"extracted {total} files...", flush=True)
    print(f"DONE {total} files extracted")


if __name__ == "__main__":
    main()
