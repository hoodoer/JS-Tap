"""
Native Python ASAR archive handling.

Implements extract/pack for Electron's ASAR format without requiring
the @electron/asar npm package. The format is straightforward:

  [sizePickle (8 bytes)] [headerPickle (variable)] [file data...]

The sizePickle is a Chromium Pickle containing a uint32 = total size
of the headerPickle buffer. The headerPickle contains a JSON string
describing the directory tree with file offsets and sizes.

File offsets in the header are relative to the end of the header section.
"""

import json
import os
import struct
import shutil
import tempfile
import gc


def _align4(n):
    """Align to 4-byte boundary."""
    return (n + 3) & ~3


def _read_pickle_uint32(f):
    """Read a Chromium Pickle containing a single uint32 value."""
    payload_size = struct.unpack('<I', f.read(4))[0]
    value = struct.unpack('<I', f.read(4))[0]
    # Skip any padding (payload_size could be > 4 if padded, but typically is 4)
    remaining = _align4(payload_size) - 4
    if remaining > 0:
        f.read(remaining)
    return value


def _read_pickle_string(f, pickle_size):
    """Read a Chromium Pickle containing a string from the current position.

    pickle_size is the total size of the pickle buffer (including the 4-byte
    payload size prefix).
    """
    payload_size = struct.unpack('<I', f.read(4))[0]
    string_length = struct.unpack('<I', f.read(4))[0]
    string_data = f.read(string_length).decode('utf-8')
    # Skip padding to consume the full pickle
    consumed = 4 + 4 + string_length  # payload_size field + string_length field + string
    remaining = pickle_size - consumed
    if remaining > 0:
        f.read(remaining)
    return string_data


def _write_pickle_uint32(value):
    """Create a Chromium Pickle buffer containing a uint32."""
    # Payload is 4 bytes (the uint32), payload_size = 4
    return struct.pack('<I', 4) + struct.pack('<I', value)


def _write_pickle_string(s):
    """Create a Chromium Pickle buffer containing a string."""
    encoded = s.encode('utf-8')
    string_length = len(encoded)
    # Payload: 4 bytes (string length) + string bytes
    payload_data = struct.pack('<I', string_length) + encoded
    payload_size = _align4(len(payload_data))
    # Pad payload to 4-byte alignment
    padding = payload_size - len(payload_data)
    return struct.pack('<I', payload_size) + payload_data + (b'\x00' * padding)


def read_header(asar_path):
    """Read and parse the ASAR header without extracting files.

    Returns:
        tuple: (header_dict, file_data_offset) where header_dict is the
               parsed JSON header and file_data_offset is the byte offset
               where file data begins.
    """
    with open(asar_path, 'rb') as f:
        # Read the size pickle (always 8 bytes)
        header_pickle_size = _read_pickle_uint32(f)

        # Read the header pickle
        header_json = _read_pickle_string(f, header_pickle_size)

        # File data starts after sizePickle (8 bytes) + headerPickle
        file_data_offset = 8 + header_pickle_size

    return json.loads(header_json), file_data_offset


def extract_file(asar_path, internal_path):
    """Extract a single file from an ASAR archive.

    Args:
        asar_path: Path to the .asar file.
        internal_path: Path within the archive (e.g., "package.json").

    Returns:
        bytes: The file contents.

    Raises:
        FileNotFoundError: If the internal path doesn't exist in the archive.
    """
    header, base_offset = read_header(asar_path)

    # Navigate the header tree to find the file entry
    # Normalize: strip ./ prefix, backslashes, leading/trailing slashes
    normalized = internal_path.replace('\\', '/').strip('/')
    if normalized.startswith('./'):
        normalized = normalized[2:]
    parts = [p for p in normalized.split('/') if p and p != '.']
    node = header.get('files', header)
    for part in parts:
        if 'files' in node:
            node = node['files']
        if part not in node:
            raise FileNotFoundError(f"Path '{internal_path}' not found in archive")
        node = node[part]

    if 'files' in node and 'offset' not in node:
        raise IsADirectoryError(f"Path '{internal_path}' is a directory, not a file")

    offset = int(node['offset'])
    size = int(node['size'])

    with open(asar_path, 'rb') as f:
        f.seek(base_offset + offset)
        return f.read(size)


def extract(asar_path, dest_dir):
    """Extract all files from an ASAR archive to a directory.

    Args:
        asar_path: Path to the .asar file.
        dest_dir: Destination directory (created if it doesn't exist).
    """
    header, base_offset = read_header(asar_path)

    os.makedirs(dest_dir, exist_ok=True)

    def _extract_node(node, current_path):
        files = node.get('files', {})
        for name, entry in files.items():
            entry_path = os.path.join(current_path, name)

            if 'files' in entry:
                # Directory
                os.makedirs(entry_path, exist_ok=True)
                _extract_node(entry, entry_path)
            elif 'offset' in entry:
                # Regular file
                offset = int(entry['offset'])
                size = int(entry['size'])

                with open(asar_path, 'rb') as f:
                    f.seek(base_offset + offset)
                    data = f.read(size)

                with open(entry_path, 'wb') as out:
                    out.write(data)

                # Restore executable permission
                if entry.get('executable', False):
                    os.chmod(entry_path, 0o755)
            elif 'link' in entry:
                # Symbolic link (some asars contain these)
                link_target = entry['link']
                target_path = os.path.join(dest_dir, link_target)
                try:
                    os.symlink(target_path, entry_path)
                except OSError:
                    pass  # Symlink creation may fail on some platforms
            # Skip unpacked files (they live in app.asar.unpacked/ alongside the asar)

    _extract_node(header, dest_dir)


def pack(source_dir, asar_path):
    """Pack a directory into an ASAR archive.

    Args:
        source_dir: Source directory to pack.
        asar_path: Output path for the .asar file.
    """
    header = {'files': {}}
    file_list = []  # List of (absolute_path, relative_offset) tuples
    current_offset = 0

    def _build_node(dir_path, node):
        nonlocal current_offset

        entries = sorted(os.listdir(dir_path))
        for name in entries:
            full_path = os.path.join(dir_path, name)

            if os.path.isdir(full_path):
                child_node = {'files': {}}
                node['files'][name] = child_node
                _build_node(full_path, child_node)
            elif os.path.isfile(full_path):
                size = os.path.getsize(full_path)
                entry = {
                    'offset': str(current_offset),
                    'size': size
                }
                if os.access(full_path, os.X_OK):
                    entry['executable'] = True
                node['files'][name] = entry
                file_list.append((full_path, current_offset, size))
                current_offset += size
            elif os.path.islink(full_path):
                link_target = os.readlink(full_path)
                # Store as relative path within the archive
                try:
                    rel_target = os.path.relpath(link_target, source_dir)
                except ValueError:
                    rel_target = link_target
                node['files'][name] = {'link': rel_target}

    _build_node(source_dir, header)

    # Build the binary
    header_json = json.dumps(header, separators=(',', ':'), sort_keys=False)
    header_pickle = _write_pickle_string(header_json)
    size_pickle = _write_pickle_uint32(len(header_pickle))

    with open(asar_path, 'wb') as f:
        f.write(size_pickle)
        f.write(header_pickle)

        for file_path, offset, size in file_list:
            with open(file_path, 'rb') as src:
                # Stream in chunks for large files
                remaining = size
                while remaining > 0:
                    chunk_size = min(remaining, 64 * 1024)
                    chunk = src.read(chunk_size)
                    if not chunk:
                        break
                    f.write(chunk)
                    remaining -= len(chunk)


def patch_file(asar_path, internal_path, new_data, output_path=None):
    """Replace a single file inside an ASAR archive, preserving everything else.

    This avoids extract/repack which loses unpacked file references.
    Reads the original header and file data, swaps the target file's contents,
    recalculates offsets, and writes a new asar.

    Args:
        asar_path: Path to the original .asar file.
        internal_path: Path within the archive to replace (e.g., "dist/boot.bundle.cjs").
        new_data: New file contents as bytes.
        output_path: Output path (default: overwrite in-place).
    """
    header, base_offset = read_header(asar_path)
    output_path = output_path or asar_path

    # Normalize the internal path
    normalized = internal_path.replace('\\', '/').strip('/')
    if normalized.startswith('./'):
        normalized = normalized[2:]
    parts = [p for p in normalized.split('/') if p and p != '.']

    # Locate the target entry in the header
    node = header
    for part in parts:
        if 'files' in node:
            node = node['files']
        if part not in node:
            raise FileNotFoundError(f"Path '{internal_path}' not found in archive")
        node = node[part]

    if 'offset' not in node:
        raise ValueError(f"Path '{internal_path}' is not a packed file (may be directory or unpacked)")

    target_old_offset = int(node['offset'])
    target_old_size = int(node['size'])
    new_size = len(new_data)
    size_delta = new_size - target_old_size

    # Collect all packed file entries with their offsets so we can rebuild
    packed_files = []

    def _collect(n, path_parts=()):
        files = n.get('files', {})
        for name, entry in files.items():
            current_path = path_parts + (name,)
            if 'files' in entry:
                _collect(entry, current_path)
            elif 'offset' in entry:
                packed_files.append(('/'.join(current_path), entry))

    _collect(header)

    # Sort by original offset to maintain file data order
    packed_files.sort(key=lambda x: int(x[1]['offset']))

    # Read all file data from the original archive, replacing the target
    file_data_chunks = []
    with open(asar_path, 'rb') as f:
        for fpath, entry in packed_files:
            old_offset = int(entry['offset'])
            old_size = int(entry['size'])
            if old_offset == target_old_offset:
                file_data_chunks.append(new_data)
            else:
                f.seek(base_offset + old_offset)
                file_data_chunks.append(f.read(old_size))

    # Recalculate offsets and update header entries
    target_path_str = '/'.join(parts)
    current_offset = 0
    for i, (fpath, entry) in enumerate(packed_files):
        chunk = file_data_chunks[i]
        entry['offset'] = str(current_offset)
        entry['size'] = len(chunk)
        # Remove integrity hash for the patched file
        if fpath == target_path_str:
            entry.pop('integrity', None)
        current_offset += len(chunk)

    # Write the new asar via temp file to avoid Windows file locking issues
    header_json = json.dumps(header, separators=(',', ':'), sort_keys=False)
    header_pickle = _write_pickle_string(header_json)
    size_pickle = _write_pickle_uint32(len(header_pickle))

    temp_fd, temp_path = tempfile.mkstemp(
        dir=os.path.dirname(output_path),
        prefix='.asar_',
        suffix='.tmp'
    )
    os.close(temp_fd)

    try:
        with open(temp_path, 'wb') as f:
            f.write(size_pickle)
            f.write(header_pickle)
            for chunk in file_data_chunks:
                f.write(chunk)

        # Force garbage collection to release any lingering file handles
        gc.collect()
        os.replace(temp_path, output_path)
    except Exception:
        try:
            os.remove(temp_path)
        except OSError:
            pass
        raise


def list_contents(asar_path):
    """List all files in an ASAR archive.

    Returns:
        list: List of file paths (relative to archive root).
    """
    header, _ = read_header(asar_path)
    paths = []

    def _walk(node, prefix):
        files = node.get('files', {})
        for name, entry in files.items():
            path = f"{prefix}/{name}" if prefix else name
            if 'files' in entry:
                _walk(entry, path)
            else:
                paths.append(path)

    _walk(header, '')
    return sorted(paths)


if __name__ == '__main__':
    import sys

    if len(sys.argv) < 3:
        print("Usage:")
        print("  python3 asar.py extract <archive.asar> <dest_dir>")
        print("  python3 asar.py pack <source_dir> <archive.asar>")
        print("  python3 asar.py list <archive.asar>")
        print("  python3 asar.py read <archive.asar> <internal_path>")
        sys.exit(1)

    command = sys.argv[1]

    if command == 'extract':
        if len(sys.argv) != 4:
            print("Usage: python3 asar.py extract <archive.asar> <dest_dir>")
            sys.exit(1)
        extract(sys.argv[2], sys.argv[3])
        print(f"Extracted to {sys.argv[3]}")

    elif command == 'pack':
        if len(sys.argv) != 4:
            print("Usage: python3 asar.py pack <source_dir> <archive.asar>")
            sys.exit(1)
        pack(sys.argv[2], sys.argv[3])
        print(f"Packed to {sys.argv[3]}")

    elif command == 'list':
        if len(sys.argv) != 3:
            print("Usage: python3 asar.py list <archive.asar>")
            sys.exit(1)
        for path in list_contents(sys.argv[2]):
            print(path)

    elif command == 'read':
        if len(sys.argv) != 4:
            print("Usage: python3 asar.py read <archive.asar> <internal_path>")
            sys.exit(1)
        data = extract_file(sys.argv[2], sys.argv[3])
        sys.stdout.buffer.write(data)

    else:
        print(f"Unknown command: {command}")
        sys.exit(1)
