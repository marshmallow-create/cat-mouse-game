// 公開URLを固定し、プロキシから届くHost値で許可先を変えません。
function serverConfig(env = process.env) {
  const production = env.NODE_ENV === "production";
  const port = Number(env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORTには1〜65535の整数を指定してください。");
  let origin = env.APP_ORIGIN;
  if (!origin && production) origin = env.RENDER_EXTERNAL_URL;
  if (production && !origin) throw new Error("公開環境にはAPP_ORIGIN（HTTPSの公開URL）が必要です。");
  if (origin) {
    const url = new URL(origin);
    if (url.username || url.password || url.search || url.hash || url.pathname !== "/"
        || !["http:", "https:"].includes(url.protocol) || (production && url.protocol !== "https:")) {
      throw new Error("APP_ORIGINにはパスを含まない公開URLを設定してください。公開環境ではHTTPSが必要です。");
    }
    origin = url.origin;
  }
  return { production, port, host: env.HOST || (production ? "0.0.0.0" : "127.0.0.1"),
    origin, allowedOrigins: production ? [origin] : [...new Set([`http://localhost:${port}`, `http://127.0.0.1:${port}`, ...(origin ? [origin] : [])])] };
}

module.exports = { serverConfig };
