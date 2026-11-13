(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  const apiBase = String((window.HAX_PASSWORD_CONFIG || {}).API_BASE_URL || "").replace(/\/+$/, "");
  let adminToken = "";
  let busy = false;

  async function api(path, options) {
    options = options || {};
    const headers = new Headers(options.headers || {});
    if (options.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    if (adminToken) headers.set("Authorization", "Bearer " + adminToken);
    const response = await fetch(apiBase + path, Object.assign({}, options, { headers }));
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "تعذر إكمال الطلب (" + response.status + ").");
    return data;
  }
  function showMsg(text, color, target) {
    const node = $(target || "msg");
    node.textContent = text;
    if (color) node.style.color = color;
  }
  function loginView(visible) {
    $("masterLoginBox").classList.toggle("hidden", !visible);
    $("controlPanel").classList.toggle("hidden", visible);
  }
  async function loginMaster() {
    if (busy) return;
    const password = $("masterLoginPassword").value;
    if (!password) return showMsg("أدخل كلمة مرور الإدارة.", "var(--danger-red)", "loginMsg");
    busy = true;
    $("masterLoginButton").disabled = true;
    showMsg("جارٍ التحقق من بيانات الدخول...", "var(--accent-glow)", "loginMsg");
    try {
      const data = await api("/api/auth/admin/login", {
        method: "POST",
        body: JSON.stringify({ password })
      });
      adminToken = data.token;
      await loadMasterControl();
      $("masterLoginPassword").value = "";
      showMsg("", "", "loginMsg");
      loginView(false);
      showMsg("تم تسجيل الدخول إلى لوحة التحكم.", "var(--success-green)");
    } catch (error) {
      showMsg("❌ " + error.message, "var(--danger-red)", "loginMsg");
    } finally {
      busy = false;
      $("masterLoginButton").disabled = false;
    }
  }
  async function loadMasterControl() {
    const values = await Promise.all([
      api("/api/admin/overview"),
      api("/api/admin/settings")
    ]);
    $("totalResellersStat").textContent = values[0].resellers || 0;
    $("totalKeysStat").textContent = values[0].keys || 0;
    $("maintClientToggle").checked = !!values[1].maintenance.client;
    $("maintResellerToggle").checked = !!values[1].maintenance.reseller;
  }
  async function toggleMaintenanceState(type) {
    const input = $(type === "client" ? "maintClientToggle" : "maintResellerToggle");
    const requested = input.checked;
    try {
      const body = {};
      body[type] = requested;
      await api("/api/admin/settings/maintenance", {
        method: "PATCH",
        body: JSON.stringify(body)
      });
      showMsg(requested ? "تم تفعيل وضع الصيانة." : "تم إيقاف وضع الصيانة.", requested ? "var(--danger-red)" : "var(--success-green)");
    } catch (error) {
      input.checked = !requested;
      showMsg("❌ " + error.message, "var(--danger-red)");
    }
  }
  function checkStrength(value) {
    const meter = $("strengthMeter");
    const fill = $("strengthFill");
    if (!value) {
      meter.style.display = "none";
      fill.style.width = "0%";
      return;
    }
    meter.style.display = "block";
    let score = 0;
    if (value.length >= 14) score++;
    if (/[a-z]/.test(value)) score++;
    if (/[A-Z]/.test(value)) score++;
    if (/[0-9]/.test(value)) score++;
    if (/[^A-Za-z0-9]/.test(value)) score++;
    fill.style.width = (score * 20) + "%";
    fill.style.backgroundColor = score <= 2 ? "var(--danger-red)" : score <= 4 ? "var(--warning-yellow)" : "var(--success-green)";
  }
  function toggleVisibility(id, button) {
    const input = $(id);
    const reveal = input.type === "password";
    input.type = reveal ? "text" : "password";
    button.style.color = reveal ? "var(--accent-glow)" : "";
  }
  function setLoading(loading) {
    $("submitBtn").disabled = loading;
    $("spin").style.display = loading ? "inline-block" : "none";
    $("btnText").textContent = loading ? "جارٍ التنفيذ..." : "تحديث كلمة السر وطرد الجلسات ➔";
  }
  async function changeAdminPassword() {
    if (busy) return;
    const currentPassword = $("oldPass").value;
    const newPassword = $("newPass").value;
    if (!currentPassword || !newPassword) return showMsg("يرجى ملء جميع الخانات المطلوبة.", "var(--danger-red)");
    if (newPassword.length < 14 || !/[a-z]/.test(newPassword) || !/[A-Z]/.test(newPassword) ||
        !/[0-9]/.test(newPassword) || !/[^A-Za-z0-9]/.test(newPassword)) {
      return showMsg("كلمة المرور تحتاج 14 حرفاً على الأقل وحروفاً كبيرة وصغيرة ورقماً ورمزاً.", "var(--warning-yellow)");
    }
    busy = true;
    setLoading(true);
    showMsg("جارٍ التحقق وتحديث كلمة المرور...", "var(--accent-glow)");
    try {
      const data = await api("/api/admin/settings/password", {
        method: "POST",
        body: JSON.stringify({ currentPassword, newPassword })
      });
      adminToken = "";
      $("oldPass").value = "";
      $("newPass").value = "";
      $("strengthMeter").style.display = "none";
      loginView(true);
      showMsg("✔ " + data.message + " سجّل الدخول بكلمة المرور الجديدة.", "var(--success-green)", "loginMsg");
      showMsg(data.message + " يجب تسجيل الدخول مجدداً.", "var(--success-green)");
    } catch (error) {
      showMsg("❌ " + error.message, "var(--danger-red)");
    } finally {
      busy = false;
      setLoading(false);
    }
  }
  function logoutMaster() {
    adminToken = "";
    $("masterLoginPassword").value = "";
    $("oldPass").value = "";
    $("newPass").value = "";
    $("strengthMeter").style.display = "none";
    $("loginMsg").textContent = "";
    loginView(true);
    showMsg("تم تسجيل الخروج.");
  }
  // Bind controls with addEventListener: Helmet CSP blocks inline event handlers.
  $("masterLoginButton").addEventListener("click", loginMaster);
  $("masterLoginPassword").addEventListener("keydown", event => {
    if (event.key === "Enter") loginMaster();
  });
  $("newPass").addEventListener("input", event => checkStrength(event.target.value));
  $("logoutMasterButton").addEventListener("click", logoutMaster);
  $("maintClientToggle").addEventListener("change", () => toggleMaintenanceState("client"));
  $("maintResellerToggle").addEventListener("change", () => toggleMaintenanceState("reseller"));
  $("oldPassEye").addEventListener("click", event => toggleVisibility("oldPass", event.currentTarget));
  $("newPassEye").addEventListener("click", event => toggleVisibility("newPass", event.currentTarget));
  $("submitBtn").addEventListener("click", changeAdminPassword);
  window.loginMaster = loginMaster;
  window.loadMasterControl = loadMasterControl;
  window.toggleMaintenanceState = toggleMaintenanceState;
  window.checkStrength = checkStrength;
  window.toggleVisibility = toggleVisibility;
  window.changeAdminPassword = changeAdminPassword;
  window.logoutMaster = logoutMaster;
})();