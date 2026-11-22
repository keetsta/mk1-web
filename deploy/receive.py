#!/usr/bin/env python3
from contextlib import contextmanager
import fcntl
import gzip
import os
from datetime import datetime, timezone
from pathlib import Path
import re
import shutil
import signal
import sys
import tarfile
import tempfile
import zlib


SHA = re.compile(r"[0-9a-f]{40}")
RELEASE = re.compile(r"[0-9]{20}-[0-9a-f]{12}")
MAX_UPLOAD = 32 * 1024 * 1024
MAX_ARCHIVE = 96 * 1024 * 1024
MAX_MEMBERS = 4096
CHUNK = 1024 * 1024
DEPLOY_TIMEOUT = 120


def copy_limited(source, destination, limit):
    size = 0
    while chunk := source.read(CHUNK):
        size += len(chunk)
        if size > limit:
            raise ValueError("archive too large")
        destination.write(chunk)


def archive_path(member):
    name = member.name.removeprefix("./")
    if member.isdir():
        name = name.rstrip("/")
        if name in {"", "."} and member.name in {".", "./"}:
            return ()
    parts = tuple(name.split("/"))
    if "\\" in name or "\x00" in name or parts[0] != "mk1" or any(part in {"", ".", ".."} for part in parts):
        raise ValueError("invalid archive path")
    if parts[:2] in {("mk1", "api"), ("mk1", "firmware")}:
        raise ValueError("archive overlaps a separately served path")
    return parts


def extract(archive, stage):
    seen = set()
    with tarfile.open(fileobj=archive, mode="r:") as source:
        for count, member in enumerate(source, start=1):
            if count > MAX_MEMBERS:
                raise ValueError("too many archive members")
            if not 0 <= member.size <= MAX_ARCHIVE:
                raise ValueError("invalid archive member size")
            parts = archive_path(member)
            if parts in seen:
                raise ValueError("duplicate archive path")
            seen.add(parts)
            target = stage.joinpath(*parts)
            if member.isdir() and member.size == 0:
                target.mkdir(parents=True, exist_ok=True)
            elif member.type in (tarfile.REGTYPE, tarfile.AREGTYPE) and member.sparse is None:
                target.parent.mkdir(parents=True, exist_ok=True)
                with source.extractfile(member) as contents, target.open("xb") as output:
                    shutil.copyfileobj(contents, output, CHUNK)
            else:
                raise ValueError("archive contains links or special files")

        # tarfile also stops at an invalid header after a valid entry.
        archive.seek(source.offset)
        end = archive.read(2 * tarfile.BLOCKSIZE)
        if end != bytes(2 * tarfile.BLOCKSIZE):
            raise ValueError("invalid archive end")
        while chunk := archive.read(CHUNK):
            if chunk.strip(b"\x00"):
                raise ValueError("invalid archive padding")

    if not (stage / "mk1/index.html").is_file() or not (stage / "mk1/top/index.html").is_file():
        raise ValueError("release is missing an index page")
    if not any(path.is_file() for path in (stage / "mk1/assets").rglob("*")):
        raise ValueError("release is missing assets")


def release_names(releases):
    return sorted(
        (entry.name for entry in releases.iterdir()
         if RELEASE.fullmatch(entry.name) and not entry.is_symlink() and entry.is_dir()),
        reverse=True,
    )


def activate(directory, name):
    current = directory / "current"
    pending = directory / ".current.tmp"
    pending.unlink(missing_ok=True)
    pending.symlink_to(Path("releases", name), target_is_directory=True)
    try:
        pending.replace(current)
    finally:
        pending.unlink(missing_ok=True)
    print(f"[{directory.name}] live: {name}")


@contextmanager
def deployment_lock(directory):
    with (directory / ".deploy.lock").open("a+b") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        yield


def deploy(directory, releases, sha):
    with tempfile.TemporaryDirectory(prefix=".incoming-", dir=releases) as incoming:
        stage = Path(incoming) / "site"
        stage.mkdir()
        with tempfile.TemporaryFile(dir=incoming) as compressed, tempfile.TemporaryFile(dir=incoming) as archive:
            copy_limited(sys.stdin.buffer, compressed, MAX_UPLOAD)
            compressed.seek(0)
            with gzip.GzipFile(fileobj=compressed) as upload:
                copy_limited(upload, archive, MAX_ARCHIVE)
            archive.seek(0)
            extract(archive, stage)
        with deployment_lock(directory):
            name = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S%f") + "-" + sha[:12]
            stage.rename(releases / name)
            activate(directory, name)

            old = [release for release in release_names(releases) if release != name]
            for release in old[4:]:
                try:
                    shutil.rmtree(releases / release)
                except TimeoutError:
                    raise
                except OSError as error:
                    print(f"could not remove {release}: {error}", file=sys.stderr)


def deploy_timeout(_signal, _frame):
    raise TimeoutError("deployment deadline exceeded")


def receive():
    args = sys.argv[1:]
    if not args or args[0] != "main":
        raise ValueError("invalid deployment branch")
    branch, *local = args
    command = os.environ.get("SSH_ORIGINAL_COMMAND")
    if command is not None:
        fields = command.split()
        if local or len(fields) != 3 or fields[:2] != ["deploy", branch] or not SHA.fullmatch(fields[2]):
            raise ValueError("expected deploy for the configured branch and a full commit sha")
    elif local != ["list"] and (len(local) != 2 or local[0] != "rollback" or not RELEASE.fullmatch(local[1])):
        raise ValueError("usage: receive main list | rollback <release>")

    directory = Path(__file__).resolve().parent.parent / branch
    releases = directory / "releases"
    if command is not None:
        signal.signal(signal.SIGALRM, deploy_timeout)
        signal.setitimer(signal.ITIMER_REAL, DEPLOY_TIMEOUT)
        try:
            deploy(directory, releases, fields[2])
        finally:
            signal.setitimer(signal.ITIMER_REAL, 0)
        return
    with deployment_lock(directory):
        if local == ["list"]:
            current = directory / "current"
            live = Path(os.readlink(current)).name if current.is_symlink() else None
            for release in release_names(releases):
                print(f"{'*' if release == live else ' '} {release}")
        elif local[1] in release_names(releases):
            activate(directory, local[1])
        else:
            raise ValueError("release not found")


if __name__ == "__main__":
    os.umask(0o022)
    try:
        receive()
    except (ValueError, OSError, EOFError, tarfile.TarError, zlib.error) as error:
        print(error, file=sys.stderr)
        sys.exit(1)
