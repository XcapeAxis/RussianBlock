function trimTrailingSlash(value) {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

export function getApiBase(explicitBase) {
  const globalBase =
    typeof window !== "undefined" && typeof window.__RUSSIAN_BLOCK_API_BASE__ === "string"
      ? window.__RUSSIAN_BLOCK_API_BASE__
      : "";
  const base = String(explicitBase || globalBase || "").trim();
  return base ? trimTrailingSlash(base) : "";
}

export class RussianBlockApiClient {
  constructor(apiBase) {
    this.apiBase = getApiBase(apiBase);
  }

  get configured() {
    return this.apiBase.length > 0;
  }

  async request(path, { method = "GET", body } = {}) {
    if (!this.configured) {
      throw new Error("API base is not configured.");
    }

    const response = await fetch(`${this.apiBase}${path}`, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || `Request failed with ${response.status}`);
    }
    return data;
  }

  uploadReplay(replay) {
    return this.request("/api/replays", {
      method: "POST",
      body: { replay },
    });
  }

  getReplay(code) {
    return this.request(`/api/replays/${encodeURIComponent(code)}`);
  }

  createChallenge(payload) {
    return this.request("/api/challenges", {
      method: "POST",
      body: payload,
    });
  }

  getChallenge(code) {
    return this.request(`/api/challenges/${encodeURIComponent(code)}`);
  }

  submitChallenge(code, payload) {
    return this.request(`/api/challenges/${encodeURIComponent(code)}/submissions`, {
      method: "POST",
      body: payload,
    });
  }

  getDaily(date) {
    return this.request(`/api/daily/${encodeURIComponent(date)}`);
  }
}
