export function getBindHost(): string {
  return process.env.RIVANO_BIND_HOST || "0.0.0.0";
}
