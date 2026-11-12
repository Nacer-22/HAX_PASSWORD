(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  const apiBase = String(window.HAX_PASSWORD_CONFIG?.API_BASE_URL || "").replace(/\/+$/, "");
  let token = "";
  let toastTimer;

  async function api(path, options = {}) {
    const headers = new Headers(options.headers || {});
    if (options.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    if (token) headers.set("Authorization", "Bearer " + token);
    const response = await fetch(apiBase + path, { ...options, headers });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "تعذر إكمال الطلب.");
    return data;
  }
  function showToast(message) {
    const toast = $("toast");
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("show"), 3200);
  }
  function showSecurity(visible) {
    $("loginPanel").classList.toggle("hidden", visible);
    $("securityPanel").classList.toggle("hidden", !visible);
  }
  function passwordScore(value) {
    let score = 0;
    if (value.length >= 14) score++;
    if (/[a-z]/.test(value)) score++;
    if (/[A-Z]/.test(value)) score++;
    if (/[0-9]/.test(value)) score++;
    if (/[^A-Za-z0-9]/.test(value)) score++;
    return score;
  }
  function updateStrength() {
    const value = $("newPassword").value;
    const score = passwordScore(value);
    const width = value ? (score / 5) * 100 : 0;
    $("strengthFill").style.width = width + "%";
    $("strengthFill").style.background = score <= 2 ? "#ef233c" : score <= 4 ? "#e0a12d" : "#43d99a";
    const messages = ["ضعيفة جداً", "ضعيفة", "متوسطة", "جيدة", "قوية", "قوية جداً"];
    $("strengthText").textContent = value ? messages[score] : "استخدم 14 حرفاً على الأقل مع أحرف كبيرة وصغيرة ورقم ورمز.";
  }
  async function loadStatus() {
    const data = await api("/api/security/status");
    $("lastChanged").textContent = data.lastChangedAt ? new Date(data.lastChangedAt).toLocaleString("ar") : "لم يتم التغيير بعد";
  }
  $("loginForm").addEventListener("submit", async event => {
    event.preventDefault();
    const button = event.submitter;
    button.disabled = true;
    $("loginMessage").textContent = "جارٍ التحقق...";
    try {
      const data = await api("/api/auth/login", { method: "POST", body: JSON.stringify({
        username: $("username").value.trim(), password: $("loginPassword").value
      }) });
      token = data.token;
      await loadStatus();
      $("loginMessage").textContent = "";
      $("loginForm").reset();
      showSecurity(true);
    } catch (error) {
      $("loginMessage").textContent = error.message;
    } finally {
      button.disabled = false;
    }
  });
  $("newPassword").addEventListener("input", updateStrength);
  document.querySelectorAll("[data-toggle]").forEach(button => button.addEventListener("click", () => {
    const input = $(button.dataset.toggle);
    input.type = input.type === "password" ? "text" : "password";
    button.textContent = input.type === "password" ? "◉" : "◎";
  }));
  $("changeForm").addEventListener("submit", async event => {
    event.preventDefault();
    const currentPassword = $("currentPassword").value;
    const newPassword = $("newPassword").value;
    const confirmPassword = $("confirmPassword").value;
    if (newPassword !== confirmPassword) {
      $("changeMessage").textContent = "تأكيد كلمة المرور غير مطابق.";
      return;
    }
    if (passwordScore(newPassword) !== 5) {
      $("changeMessage").textContent = "اختر كلمة مرور أقوى وفق الشروط الموضحة.";
      return;
    }
    const button = $("changeButton");
    button.disabled = true;
    $("changeMessage").textContent = "جارٍ تحديث كلمة المرور...";
    try {
      const data = await api("/api/password/change", {
        method: "POST",
        body: JSON.stringify({ currentPassword, newPassword })
      });
      token = data.token;
      $("changeForm").reset();
      updateStrength();
      $("lastChanged").textContent = new Date(data.lastChangedAt).toLocaleString("ar");
      $("changeMessage").textContent = data.message;
      showToast(data.message);
    } catch (error) {
      $("changeMessage").textContent = error.message;
    } finally {
      button.disabled = false;
    }
  });
  $("logout").addEventListener("click", () => {
    token = "";
    $("loginForm").reset();
    $("changeForm").reset();
    $("loginMessage").textContent = "";
    $("changeMessage").textContent = "";
    updateStrength();
    showSecurity(false);
  });
  updateStrength();
  showSecurity(false);
})();
