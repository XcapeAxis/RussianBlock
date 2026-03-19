function trimTrailingSlash(value) {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function buildQueryString(params = {}) {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value === null || value === undefined || value === "") {
      return;
    }
    search.set(key, String(value));
  });
  const query = search.toString();
  return query ? `?${query}` : "";
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

  submitDaily(date, payload) {
    return this.request(`/api/daily/${encodeURIComponent(date)}/submissions`, {
      method: "POST",
      body: payload,
    });
  }

  getLeaderboard(board, params = {}) {
    return this.request(`/api/leaderboards/${encodeURIComponent(board)}${buildQueryString(params)}`);
  }

  createRoom(payload) {
    return this.request("/api/rooms", {
      method: "POST",
      body: payload,
    });
  }

  getPublicRooms(params = {}) {
    return this.request(`/api/rooms/public${buildQueryString(params)}`);
  }

  getRoom(code, params = {}) {
    return this.request(`/api/rooms/${encodeURIComponent(code)}${buildQueryString(params)}`);
  }

  joinRoom(code, payload) {
    return this.request(`/api/rooms/${encodeURIComponent(code)}/join`, {
      method: "POST",
      body: payload,
    });
  }

  leaveRoom(code, payload) {
    return this.request(`/api/rooms/${encodeURIComponent(code)}/leave`, {
      method: "POST",
      body: payload,
    });
  }

  updateRoomStart(code, payload) {
    return this.request(`/api/rooms/${encodeURIComponent(code)}/start`, {
      method: "POST",
      body: payload,
    });
  }

  submitRoom(code, payload) {
    return this.request(`/api/rooms/${encodeURIComponent(code)}/submit`, {
      method: "POST",
      body: payload,
    });
  }

  rematchRoom(code, payload) {
    return this.request(`/api/rooms/${encodeURIComponent(code)}/rematch`, {
      method: "POST",
      body: payload,
    });
  }
}
