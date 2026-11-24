export function resolveFileSizeBytes(record) {
  if (!record) return null;
  const candidates = [
    record.file_size,
    record?.metadata?.file_size,
    record?.metadata?.size,
    record?.metadata?.fileSize,
  ];

  for (const value of candidates) {
    const num = Number(value);
    if (Number.isFinite(num) && num > 0) return num;
  }

  return null;
}

export function formatFileSize(bytes) {
  const size = Number(bytes);
  if (!Number.isFinite(size) || size <= 0) return '—';

  // Choose the unit from the rounded value, so 1023.6 B becomes "1.0 KB"
  // rather than "1024 B", and 1048575 B becomes "1.0 MB" rather than "1024.0 KB".
  if (Number(size.toFixed(0)) < 1024) return `${size.toFixed(0)} B`;
  if (Number((size / 1024).toFixed(1)) < 1024) return `${(size / 1024).toFixed(1)} KB`;

  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}
