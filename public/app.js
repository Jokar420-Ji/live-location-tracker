const socket = io();
const params = new URLSearchParams(location.search);

const isSharer = params.get("share") === "1";
const sessionId = params.get("track");

let map, marker, accuracyCircle, watchId = null;

const $ = id => document.getElementById(id);

function initMap() {
  map = L.map("map").setView([20.5937, 78.9629], 5);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap contributors"
  }).addTo(map);
}

initMap();

function setLive(active) {
  $("heroDot").classList.toggle("live", active);
  $("heroStatus").textContent = active ? "LIVE location" : "Waiting";
  $("heroHint").textContent = active
    ? "Mobile GPS is updating"
    : "Waiting for mobile";
}

function drawLocation(d) {
  const lat = +d.lat;
  const lng = +d.lng;

  $("lat").textContent = lat.toFixed(6);
  $("lng").textContent = lng.toFixed(6);
  $("accuracy").textContent = d.accuracy
    ? Math.round(d.accuracy) + " m"
    : "—";

  $("updated").textContent = new Date(
    d.timestamp || Date.now()
  ).toLocaleTimeString();

  if (!marker) {
    marker = L.marker([lat, lng])
      .addTo(map)
      .bindPopup("Mobile live location");
  } else {
    marker.setLatLng([lat, lng]);
  }

  if (d.accuracy) {
    if (!accuracyCircle) {
      accuracyCircle = L.circle([lat, lng], {
        radius: d.accuracy
      }).addTo(map);
    } else {
      accuracyCircle
        .setLatLng([lat, lng])
        .setRadius(d.accuracy);
    }
  }

  map.setView([lat, lng], Math.max(map.getZoom(), 15));

  loadWeather(lat, lng);
}

async function loadWeather(lat, lng) {
  try {
    const r = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,apparent_temperature,wind_speed_10m,weather_code&timezone=auto`
    );

    const d = await r.json();
    const c = d.current;

    $("temp").textContent = Math.round(c.temperature_2m);
    $("feels").textContent =
      Math.round(c.apparent_temperature) + " °C";
    $("wind").textContent =
      Math.round(c.wind_speed_10m) + " km/h";

    $("weatherPlace").textContent = "Mobile GPS area";

    $("weatherIcon").textContent =
      c.weather_code === 0
        ? "☀️"
        : c.weather_code < 3
        ? "🌤️"
        : c.weather_code < 70
        ? "☁️"
        : "🌧️";
  } catch (e) {
    $("weatherPlace").textContent = "Unavailable";
  }
}

function join() {
  if (!sessionId) {
    console.log("No tracking session ID found.");
    return;
  }

  socket.emit("join-session", {
    id: sessionId,
    role: isSharer ? "sharer" : "admin"
  });
}

function createSession() {
  fetch("/api/session", {
    method: "POST"
  })
    .then(r => r.json())
    .then(d => {
      const url =
        location.origin +
        "/?track=" +
        d.id;

      history.replaceState(
        {},
        "",
        "/?track=" + d.id
      );

      location.reload();
    });
}

if (isSharer) {
  document.body.classList.add("mobile-share");

  document.querySelector(".hero h1").innerHTML =
    "Share your<br><span>live location.</span>";

  document.querySelector(".sub").textContent =
    "Your location will only be shared after you press the button below and allow GPS permission.";

  $("createBtn").style.display = "none";
  $("linkArea").classList.add("hidden");

  const controls = document.querySelector(".controls");

  const btn = document.createElement("button");

  btn.id = "shareLocationBtn";
  btn.className = "primary";
  btn.textContent = "📍 Share My Live Location";

  controls.insertBefore(btn, controls.firstChild);

  // IMPORTANT:
  // Phone must join the tracking session
  // before sending GPS location.
  join();

  btn.onclick = () => {
    if (!navigator.geolocation) {
      return alert(
        "This phone/browser does not support GPS."
      );
    }

    navigator.geolocation.getCurrentPosition(
      startSharing,
      geoError,
      {
        enableHighAccuracy: true,
        timeout: 15000
      }
    );
  };
} else {
  $("createBtn").onclick = createSession;

  $("copyBtn").onclick = async () => {
    await navigator.clipboard.writeText(
      $("shareUrl").value
    );

    $("copyBtn").textContent = "Copied!";

    setTimeout(
      () => $("copyBtn").textContent = "Copy",
      1500
    );
  };

  if (sessionId) {
    $("sessionLabel").textContent =
      "Session: " + sessionId;

    $("shareUrl").value =
      location.origin +
      "/?track=" +
      sessionId +
      "&share=1";

    $("linkArea").classList.remove("hidden");

    join();
  }
}

function startSharing(pos) {
  send(pos);

  watchId = navigator.geolocation.watchPosition(
    send,
    geoError,
    {
      enableHighAccuracy: true,
      maximumAge: 2000,
      timeout: 15000
    }
  );

  $("shareLocationBtn").disabled = true;

  $("shareLocationBtn").textContent =
    "🟢 Live location sharing";

  socket.emit("tracking-status", {
    active: true
  });

  setLive(true);
}

function send(pos) {
  const c = pos.coords;

  socket.emit("location-update", {
    lat: c.latitude,
    lng: c.longitude,
    accuracy: c.accuracy,
    speed: c.speed,
    heading: c.heading
  });
}

function geoError(e) {
  alert(
    e.code === 1
      ? "Location permission denied. Please allow location access."
      : e.code === 2
      ? "Location unavailable."
      : "Location request timed out."
  );
}

socket.on("connect", () => {
  console.log("Socket connected:", socket.id);

  // Rejoin after connection/reconnection
  if (sessionId) {
    join();
  }
});

socket.on("session-state", s => {
  if (!isSharer && s.location) {
    drawLocation(s.location);
  }

  if (s.active) {
    setLive(true);
  }

  if (!isSharer) {
    $("phoneStatus").textContent =
      s.sharerConnected
        ? "Phone connected"
        : "Phone not connected";
  }
});

socket.on("location-update", d => {
  if (!isSharer) {
    drawLocation(d);
  }
});

socket.on("tracking-status", d => {
  setLive(d.active);
});

socket.on("sharer-status", v => {
  if (!isSharer) {
    $("phoneStatus").textContent =
      v
        ? "Phone connected"
        : "Phone disconnected";

    setLive(v);
  }
});

socket.on("session-error", m => {
  alert(m);
});
