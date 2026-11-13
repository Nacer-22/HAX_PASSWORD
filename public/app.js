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

  async function loadAdminData() {
    const [overview, settings, resellerData, keyData] = await Promise.all([
      api("/api/admin/overview"), api("/api/admin/settings"),
      api("/api/admin/resellers"), api("/api/admin/keys")
    ]);
    $("totalResellersStat").textContent = overview.resellers || 0;
    $("totalKeysStat").textContent = overview.keys || 0;
    $("maintClientToggle").checked = !!settings.maintenance.client;
    $("maintResellerToggle").checked = !!settings.maintenance.reseller;
    $("basePriceInput").value = Number(settings.basePrice || 0).toFixed(2);
    $("currentPriceDisplay").textContent = Number(settings.basePrice || 0).toFixed(2);
    const resellers = resellerData.resellers || [];
    $("adminResellersTableBody").innerHTML = resellers.length ? resellers.map(r =>
      '<tr><td><input class="reseller-cb" type="checkbox" value="'+r.id+'"></td><td>'+escapeHtml(r.label)+'<br><small>'+escapeHtml(r.displayCode)+'</small></td><td>'+Number(r.balance||0).toFixed(2)+'</td><td>'+Number(r.keysCount||0)+'</td><td><button class="mini-danger" data-admin-act="delres" data-id="'+r.id+'">حذف</button></td></tr>'
    ).join("") : '<tr><td colspan="5">لا يوجد موزعون.</td></tr>';
    $("chargeSelectReseller").innerHTML = '<option value="">اختر الموزع</option>'+resellers.map(r=>'<option value="'+r.id+'">'+escapeHtml(r.label)+' — '+Number(r.balance||0).toFixed(2)+'</option>').join("");
    const keys = keyData.keys || [];
    $("adminKeysTableBody").innerHTML = keys.length ? keys.map(k => {
      const expired = k.expired || !k.expiresAt || Date.parse(k.expiresAt)<=Date.now();
      const active = k.isActive !== false && !expired;
      const models = Array.isArray(k.activations) && k.activations.length ? k.activations.map(a => escapeHtml(a.model || "الموديل غير متاح")).join("، ") : "لم يتم تفعيل المفتاح بعد";
      return '<tr><td style="word-break:break-all">'+escapeHtml(k.code)+'<br><small style="color:#ff7180">الأجهزة: '+models+'</small></td><td>'+escapeHtml(k.resellerLabel||"الإدارة")+'</td><td>'+(active?'نشط':(expired?'منتهي':'موقوف'))+'</td><td>'+Number(k.usedDevices||0)+' / '+Number(k.devices||1)+'</td><td><button class="mini-action" data-admin-act="togglekey" data-id="'+k.id+'" data-active="'+(!active)+'">'+(active?'إيقاف':'تفعيل')+'</button><button class="mini-action" data-admin-act="resetkey" data-id="'+k.id+'">تصفير الأجهزة</button><button class="mini-danger" data-admin-act="delkey" data-id="'+k.id+'">حذف</button></td></tr>';
    }).join("") : '<tr><td colspan="5">لا توجد مفاتيح.</td></tr>';
  }
  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
  }
  async function addReseller() {
    const label = $("addResellerCode").value.trim();
    const balance = Number($("addResellerBal").value);
    if (!Number.isFinite(balance) || balance < 0) return showMsg("أدخل رصيداً صالحاً.", "var(--danger-red)");
    try {
      const data = await api("/api/admin/resellers", {method:"POST",body:JSON.stringify({label:label || "موزع جديد",balance})});
      $("addResellerCode").value = "";
      await loadAdminData();
      showMsg("تم إنشاء الموزع. رمز الدخول: "+data.accessCode, "var(--success-green)");
      if (navigator.clipboard?.writeText) navigator.clipboard.writeText(data.accessCode).catch(()=>{});
    } catch(e) { showMsg("❌ "+e.message,"var(--danger-red)"); }
  }
  async function chargeBalance(action) {
    const id=$("chargeSelectReseller").value, amount=Number($("chargeAmount").value);
    if(!id || !Number.isFinite(amount) || amount<=0) return showMsg("اختر موزعاً وأدخل مبلغاً صالحاً.","var(--danger-red)");
    try {
      await api("/api/admin/resellers/"+encodeURIComponent(id)+"/balance",{method:"PATCH",body:JSON.stringify({amount,action})});
      $("chargeAmount").value=""; await loadAdminData(); showMsg("تم تحديث رصيد الموزع.","var(--success-green)");
    } catch(e){showMsg("❌ "+e.message,"var(--danger-red)");}
  }
  async function updatePrice() {
    const price=Number($("basePriceInput").value);
    if(!Number.isFinite(price)||price<0) return showMsg("السعر غير صالح.","var(--danger-red)");
    try { const d=await api("/api/admin/settings",{method:"PATCH",body:JSON.stringify({price})}); $("currentPriceDisplay").textContent=Number(d.basePrice).toFixed(2); showMsg("تم حفظ السعر.","var(--success-green)"); }
    catch(e){showMsg("❌ "+e.message,"var(--danger-red)");}
  }
  async function generateAdminKeys() {
    const durationMs=Number($("adminKeyDuration").value), devices=Number($("adminKeyDevices").value), quantity=Number($("adminKeyQuantity").value);
    if(!Number.isInteger(quantity)||quantity<1||quantity>50) return showMsg("الكمية يجب أن تكون بين 1 و50.","var(--danger-red)");
    try {
      const d=await api("/api/admin/keys",{method:"POST",body:JSON.stringify({durationMs,devices,quantity})});
      $("adminGeneratedKeys").textContent=(d.keys||[]).map(k=>k.code).join("\n");
      await loadAdminData(); showMsg("تم إنشاء المفاتيح بنجاح.","var(--success-green)");
    } catch(e){showMsg("❌ "+e.message,"var(--danger-red)");}
  }
  async function adminAction(action,id,el) {
    try {
      if(action==="delres") { if(!confirm("حذف الموزع وكل مفاتيحه؟")) return; await api("/api/admin/resellers/"+encodeURIComponent(id),{method:"DELETE"}); }
      if(action==="delkey") { if(!confirm("حذف هذا المفتاح؟")) return; await api("/api/admin/keys/"+encodeURIComponent(id),{method:"DELETE"}); }
      if(action==="resetkey") { if(!confirm("تصفير الأجهزة المرتبطة بهذا المفتاح؟")) return; await api("/api/admin/keys/"+encodeURIComponent(id)+"/reset",{method:"POST"}); }
      if(action==="togglekey") await api("/api/admin/keys/"+encodeURIComponent(id),{method:"PATCH",body:JSON.stringify({isActive:el.dataset.active==="true"})});
      await loadAdminData(); showMsg("تم تنفيذ العملية.","var(--success-green)");
    } catch(e){showMsg("❌ "+e.message,"var(--danger-red)");}
  }
  async function deleteSelectedResellers() {
    const ids=Array.from(document.querySelectorAll(".reseller-cb:checked")).map(x=>x.value);
    if(!ids.length) return showMsg("حدد موزعاً واحداً على الأقل.","var(--danger-red)");
    if(!confirm("حذف "+ids.length+" موزع؟")) return;
    try { for(const id of ids) await api("/api/admin/resellers/"+encodeURIComponent(id),{method:"DELETE"}); await loadAdminData(); showMsg("تم حذف الموزعين المحددين.","var(--success-green)"); }
    catch(e){showMsg("❌ "+e.message,"var(--danger-red)");}
  }
  async function deleteAllKeys() {
    if(!confirm("تحذير: حذف جميع مفاتيح النظام؟")) return;
    try { const d=await api("/api/admin/keys",{method:"DELETE"}); await loadAdminData(); showMsg("تم حذف "+d.deleted+" مفتاح.","var(--success-green)"); }
    catch(e){showMsg("❌ "+e.message,"var(--danger-red)");}
  }

  async function loadMasterControl() {
    await loadAdminData();
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
  $("addResellerBtn").addEventListener("click", addReseller);
  $("chargeAddBtn").addEventListener("click", () => chargeBalance("add"));
  $("chargeDeductBtn").addEventListener("click", () => chargeBalance("deduct"));
  $("updatePriceBtn").addEventListener("click", updatePrice);
  $("adminGenerateKeysBtn").addEventListener("click", generateAdminKeys);
  $("deleteSelectedResellersBtn").addEventListener("click", deleteSelectedResellers);
  $("deleteAllSystemKeysBtn").addEventListener("click", deleteAllKeys);
  $("selectAllResellers").addEventListener("change", e => document.querySelectorAll(".reseller-cb").forEach(cb => cb.checked=e.target.checked));
  document.addEventListener("click", event => {
    const el=event.target.closest("[data-admin-act]");
    if(el) adminAction(el.dataset.adminAct,el.dataset.id,el);
  });
  window.loginMaster = loginMaster;
  window.loadMasterControl = loadMasterControl;
  window.toggleMaintenanceState = toggleMaintenanceState;
  window.checkStrength = checkStrength;
  window.toggleVisibility = toggleVisibility;
  window.changeAdminPassword = changeAdminPassword;
  window.logoutMaster = logoutMaster;
})();