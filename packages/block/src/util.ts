export function checkBufferLength(value: Buffer, expected: number): Buffer {
  const provided = value.length
  if (provided != expected) {
    throw new Error(
      `Expected Buffer length for ${value} on initialization is ${expected}, provided: ${provided}`,
    )
  }
  return value
}
