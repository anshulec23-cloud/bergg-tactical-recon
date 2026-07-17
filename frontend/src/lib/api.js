const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000";

async function request(path, options = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || `Request failed: ${response.status}`);
  }
  return response.json();
}

export async function scanLocation(payload) {
  return request("/scan", { method: "POST", body: JSON.stringify(payload) });
}

export async function summarizeLocation(location_data) {
  return request("/ai-summary", { method: "POST", body: JSON.stringify({ location_data }) });
}

export async function routeBetween(source, destination, mode = "driving") {
  return request("/routes", { method: "POST", body: JSON.stringify({ source, destination, mode }) });
}

export async function fetchWifiHeatmap(hours = 24) {
  return request(`/wifi-heatmap?hours=${hours}`);
}

export { API_BASE_URL };
