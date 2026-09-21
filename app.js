// ============================================================
// Wishlist — app logic.
// Real Supabase auth, groups, members, and wishlist items.
// (Theme/preferences/skeleton/drawer/modal UI below is unchanged
// from the original prototype; only the data layer is new.)
// ============================================================

const $ = (id) => document.getElementById(id);

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ---------- App state ----------
let currentUser = null;      // { id, email }
let currentGroupId = null;   // uuid of the group currently open
let currentGroupName = "";
let currentMembers = [];     // [{ user_id, nickname, email }]
let currentMemberId = null;  // whose wishlist is showing in group-screen

// ---------- Theme: light / dark / system ----------
function applyTheme(choice) {
  if (choice === "system") {
    document.documentElement.removeAttribute("data-theme");
  } else {
    document.documentElement.setAttribute("data-theme", choice);
  }
  document.querySelectorAll("[data-theme-choice]").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.themeChoice === choice);
  });
}
function setTheme(choice) {
  localStorage.setItem("wishlist-theme", choice);
  applyTheme(choice);
}
document.querySelectorAll("[data-theme-choice]").forEach(btn => {
  btn.addEventListener("click", () => setTheme(btn.dataset.themeChoice));
});
applyTheme(localStorage.getItem("wishlist-theme") || "system");

// ---------- Preferences: large text / compact view / confirm-before-remove ----------
const prefs = Object.assign(
  { largeText: false, compactView: false, confirmRemove: true },
  JSON.parse(localStorage.getItem("wishlist-prefs") || "{}")
);
function applyPrefs() {
  document.documentElement.classList.toggle("large-text", prefs.largeText);
  document.documentElement.classList.toggle("compact-view", prefs.compactView);
}
function setPref(key, value) {
  prefs[key] = value;
  localStorage.setItem("wishlist-prefs", JSON.stringify(prefs));
  applyPrefs();
}
applyPrefs();

// ---------- Screen switching ----------
function goToScreen(id) {
  document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
  $(id).classList.add("active");
  $("ai-fab").classList.toggle("hidden", id !== "group-screen");
  $("drawer-group-only").classList.toggle("hidden", id !== "group-screen");
  if (id !== "group-screen") {
    $("ai-panel").classList.add("hidden");
    closeDrawer();
    $("settings-backdrop").classList.add("hidden");
    $("settings-modal").classList.add("hidden");
    $("add-item-backdrop").classList.add("hidden");
    $("add-item-modal").classList.add("hidden");
  }
}

// ============================================================
// Auth screen (sign in / create account)
// ============================================================
function setAuthTab(tab) {
  document.querySelectorAll("#auth-tabs [data-auth-tab]").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.authTab === tab);
  });
  $("signin-form").classList.toggle("hidden", tab !== "signin");
  $("signup-form").classList.toggle("hidden", tab !== "signup");
  $("auth-error").textContent = "";
}
document.querySelectorAll("#auth-tabs [data-auth-tab]").forEach(btn => {
  btn.addEventListener("click", () => setAuthTab(btn.dataset.authTab));
});

function openAuthScreen(tab) {
  goToScreen("auth-screen");
  setAuthTab(tab || "signin");
}
$("start-signin").addEventListener("click", () => openAuthScreen("signin"));
$("start-create").addEventListener("click", () => openAuthScreen("signup"));
$("auth-back").addEventListener("click", () => goToScreen("start-screen"));
$("start-skip").addEventListener("click", enterDashboard);

$("signin-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = $("signin-email").value.trim();
  const password = $("signin-password").value;
  $("auth-error").textContent = "";
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) {
    $("auth-error").textContent = error.message;
    return;
  }
  await onSignedIn(data.user);
});

$("signup-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = $("signup-email").value.trim();
  const password = $("signup-password").value;
  const confirm = $("signup-password-confirm").value;
  $("auth-error").textContent = "";
  if (password !== confirm) {
    $("auth-error").textContent = "Passwords don't match.";
    return;
  }
  const { data, error } = await sb.auth.signUp({ email, password });
  if (error) {
    $("auth-error").textContent = error.message;
    return;
  }
  if (data.user && !data.session) {
    // Email confirmation is turned on in this Supabase project.
    $("auth-error").style.color = "var(--evergreen)";
    $("auth-error").textContent = "Check your email to confirm your account, then sign in.";
    setAuthTab("signin");
    return;
  }
  await onSignedIn(data.user);
});

$("forgot-password-link").addEventListener("click", async () => {
  const email = $("signin-email").value.trim();
  if (!email) {
    $("auth-error").textContent = "Enter your email above first, then click \"Forgot password?\" again.";
    return;
  }
  const { error } = await sb.auth.resetPasswordForEmail(email);
  $("auth-error").style.color = error ? "var(--danger)" : "var(--evergreen)";
  $("auth-error").textContent = error ? error.message : "Password reset email sent.";
});

function setUserBadge(email) {
  document.querySelectorAll(".user-badge-email").forEach(el => { el.textContent = email || ""; });
}

async function signOutEverywhere() {
  await sb.auth.signOut();
  currentUser = null;
  currentGroupId = null;
  goToScreen("start-screen");
}
document.querySelectorAll(".header-logout-btn").forEach(btn => {
  btn.addEventListener("click", signOutEverywhere);
});

async function onSignedIn(user) {
  currentUser = { id: user.id, email: user.email };
  setUserBadge(currentUser.email);
  await enterDashboard();
}

// Resume an existing session on page load (so people don't have to
// sign in again every visit), otherwise stay on the start screen.
(async () => {
  const { data } = await sb.auth.getSession();
  if (data.session && data.session.user) {
    currentUser = { id: data.session.user.id, email: data.session.user.email };
    setUserBadge(currentUser.email);
    await enterDashboard();
  }
})();

// ============================================================
// Dashboard — your groups
// ============================================================
async function enterDashboard() {
  goToScreen("dashboard-screen");
  const grid = $("groups-grid");
  grid.innerHTML = skeletonGroupCards(3);
  await loadGroups();
}

async function loadGroups() {
  const grid = $("groups-grid");
  if (!currentUser) {
    // "Skip for now" testing mode: no real account, nothing to load.
    grid.innerHTML = `<p class="empty-state">Sign in to see your real groups. (You're in local testing mode.)</p>`;
    return;
  }

  const { data, error } = await sb
    .from("group_members")
    .select("nickname, groups ( id, name, invite_code )")
    .eq("user_id", currentUser.id);

  if (error) {
    grid.innerHTML = `<p class="empty-state">Couldn't load your groups: ${error.message}</p>`;
    return;
  }

  const groups = (data || []).map(row => row.groups).filter(Boolean);

  if (groups.length === 0) {
    grid.innerHTML = `<p class="empty-state">No groups yet — create one or join with an invite code above.</p>`;
    return;
  }

  grid.innerHTML = groups.map(g => `
    <div class="group-tag" data-group-id="${g.id}" data-group-name="${escapeHtml(g.name)}" data-invite-code="${g.invite_code}">
      <h3>${escapeHtml(g.name)}</h3>
      <div class="invite-code">Invite code: ${g.invite_code}</div>
    </div>
  `).join("");
  attachGroupCardHandlers();
}

function attachGroupCardHandlers() {
  document.querySelectorAll(".group-tag").forEach(card => {
    card.addEventListener("click", () => {
      openGroup(card.dataset.groupId, card.dataset.groupName, card.dataset.inviteCode);
    });
  });
}

// "Create group" / "Join group" controls (the .new-group-row inputs/buttons in the dashboard)
const newGroupNameInput = document.querySelector('.new-group-row input[type="text"]');
const createGroupBtn = document.querySelector('.new-group-row .btn-primary');
const joinCodeInput = document.querySelectorAll('.new-group-row input[type="text"]')[1];
const joinGroupBtn = document.querySelector('.new-group-row .btn-gold');

if (createGroupBtn) {
  createGroupBtn.addEventListener("click", async () => {
    if (!currentUser) { alert("Sign in first to create a group."); return; }
    const name = newGroupNameInput.value.trim();
    if (!name) { newGroupNameInput.focus(); return; }

    const { data: group, error } = await sb
      .from("groups")
      .insert({ name, created_by: currentUser.id })
      .select()
      .single();
    if (error) { alert("Couldn't create group: " + error.message); return; }

    const { error: memberError } = await sb
      .from("group_members")
      .insert({ group_id: group.id, user_id: currentUser.id, nickname: "You" });
    if (memberError) { alert("Group created, but couldn't add you to it: " + memberError.message); return; }

    newGroupNameInput.value = "";
    await loadGroups();
  });
}

if (joinGroupBtn) {
  joinGroupBtn.addEventListener("click", async () => {
    if (!currentUser) { alert("Sign in first to join a group."); return; }
    const code = joinCodeInput.value.trim();
    if (!code) { joinCodeInput.focus(); return; }

    const { data: group, error } = await sb
      .from("groups")
      .select("id, name")
      .eq("invite_code", code)
      .maybeSingle();
    if (error || !group) { alert("No group found with that invite code."); return; }

    const { error: memberError } = await sb
      .from("group_members")
      .insert({ group_id: group.id, user_id: currentUser.id, nickname: "You" });
    if (memberError) { alert("Couldn't join: " + memberError.message); return; }

    joinCodeInput.value = "";
    await loadGroups();
  });
}

// ---------- Skeleton loaders ----------
function skeletonItemCards(count) {
  return Array.from({ length: count }).map(() => `
    <div class="skeleton-card">
      <div class="skeleton-block thumb"></div>
      <div class="skeleton-block line"></div>
      <div class="skeleton-block line short"></div>
      <div class="skeleton-block line tiny"></div>
    </div>
  `).join("");
}
function skeletonGroupCards(count) {
  return Array.from({ length: count }).map(() => `
    <div class="skeleton-group">
      <div class="skeleton-block line"></div>
      <div class="skeleton-block line tiny"></div>
    </div>
  `).join("");
}

// ============================================================
// Group screen — members + wishlist items
// ============================================================
async function openGroup(groupId, groupName, inviteCode) {
  currentGroupId = groupId;
  currentGroupName = groupName;
  $("group-view-title").textContent = groupName;
  $("group-invite-code").textContent = inviteCode ? `Invite code: ${inviteCode}` : "";
  goToScreen("group-screen");
  await loadMembers();
}

async function loadMembers() {
  const { data, error } = await sb
    .from("group_members")
    .select("user_id, nickname, profiles ( email )")
    .eq("group_id", currentGroupId);

  const list = $("member-list");
  if (error) {
    list.innerHTML = `<li class="empty-state">Couldn't load members: ${error.message}</li>`;
    return;
  }

  currentMembers = (data || []).map(row => ({
    user_id: row.user_id,
    nickname: row.nickname || (row.profiles ? row.profiles.email : "Member"),
  }));

  list.innerHTML = currentMembers.map(m => `
    <li data-member="${m.user_id}" class="${m.user_id === currentUser.id ? "active" : ""}">
      ${escapeHtml(m.nickname)}${m.user_id === currentUser.id ? ' <span class="you-tag">(you)</span>' : ""}
    </li>
  `).join("");

  document.querySelectorAll("#member-list li").forEach(li => {
    li.addEventListener("click", () => {
      document.querySelectorAll("#member-list li").forEach(x => x.classList.remove("active"));
      li.classList.add("active");
      loadWishlist(li.dataset.member);
      closeDrawer();
    });
  });

  const me = currentMembers.find(m => m.user_id === currentUser.id);
  await loadWishlist(currentUser.id, me ? me.nickname : "You");
}

async function loadWishlist(memberUserId) {
  currentMemberId = memberUserId;
  $("wishlist-items").innerHTML = skeletonItemCards(2);

  const member = currentMembers.find(m => m.user_id === memberUserId);
  $("wishlist-owner-heading").textContent =
    memberUserId === currentUser.id ? "Your wishlist" : `${member ? member.nickname : "Their"}'s wishlist`;

  const { data, error } = await sb
    .from("wishlist_items")
    .select("*")
    .eq("group_id", currentGroupId)
    .eq("user_id", memberUserId)
    .order("created_at", { ascending: false });

  renderItems(memberUserId, error ? [] : (data || []), error);
}

function renderItems(memberUserId, items, error) {
  const container = $("wishlist-items");
  const isMine = memberUserId === currentUser.id;

  const addButtonHtml = isMine
    ? `<button class="btn btn-primary btn-small" id="inline-add-item-btn" style="margin-bottom:14px;">+ Add item</button>`
    : "";

  if (error) {
    container.innerHTML = `${addButtonHtml}<p class="empty-state">Couldn't load items: ${error.message}</p>`;
  } else if (items.length === 0) {
    container.innerHTML = `${addButtonHtml}<p class="empty-state">No items yet.</p>`;
  } else {
    container.innerHTML = addButtonHtml + items.map(item => `
      <div class="item-tag" data-item-id="${item.id}">
        <img src="${item.image_url || placeholderImageFor(item.name)}" alt="${escapeHtml(item.name)}" />
        <h4>${escapeHtml(item.name)}</h4>
        ${item.description ? `<p>${escapeHtml(item.description)}</p>` : ""}
        ${item.link ? `<a href="${item.link}" target="_blank" rel="noopener">View item &rarr;</a>` : ""}
        ${isMine ? `<div class="item-actions"><button class="btn btn-ghost btn-small" data-remove-id="${item.id}">Remove</button></div>` : ""}
      </div>
    `).join("");
  }

  if (isMine) {
    const addBtn = $("inline-add-item-btn");
    if (addBtn) addBtn.addEventListener("click", openAddItemModal);
    container.querySelectorAll("[data-remove-id]").forEach(btn => {
      btn.addEventListener("click", async () => {
        if (prefs.confirmRemove && !confirm("Remove this item from your wishlist?")) return;
        const { error: delError } = await sb.from("wishlist_items").delete().eq("id", btn.dataset.removeId);
        if (delError) { alert("Couldn't remove item: " + delError.message); return; }
        await loadWishlist(currentUser.id);
      });
    });
  }
}

function placeholderImageFor(name) {
  const initials = encodeURIComponent((name || "?").slice(0, 2).toUpperCase());
  return `https://placehold.co/300x300/D3EBFA/2F4A3D?text=${initials}`;
}
function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str == null ? "" : String(str);
  return div.innerHTML;
}

$("back-to-dashboard").addEventListener("click", () => goToScreen("dashboard-screen"));

$("ai-fab").addEventListener("click", () => $("ai-panel").classList.toggle("hidden"));
$("ai-close").addEventListener("click", () => $("ai-panel").classList.add("hidden"));

// ---------- Right-side group menu drawer ----------
function openDrawer() {
  $("member-drawer").classList.add("open");
  $("drawer-backdrop").classList.remove("hidden");
}
function closeDrawer() {
  $("member-drawer").classList.remove("open");
  $("drawer-backdrop").classList.add("hidden");
}
$("hamburger-btn").addEventListener("click", openDrawer);
$("drawer-close").addEventListener("click", closeDrawer);
$("drawer-backdrop").addEventListener("click", closeDrawer);

$("drawer-settings-btn").addEventListener("click", () => {
  closeDrawer();
  openSettingsModal();
});

$("drawer-add-item-btn").addEventListener("click", () => {
  closeDrawer();
  document.querySelectorAll("#member-list li").forEach(x => x.classList.remove("active"));
  const mine = document.querySelector(`#member-list li[data-member="${currentUser.id}"]`);
  if (mine) mine.classList.add("active");
  loadWishlist(currentUser.id);
  openAddItemModal();
});

// ---------- Add-to-wishlist modal ----------
function openAddItemModal() {
  $("add-item-backdrop").classList.remove("hidden");
  $("add-item-modal").classList.remove("hidden");
  $("item-name-input").focus();
}
function closeAddItemModal() {
  $("add-item-backdrop").classList.add("hidden");
  $("add-item-modal").classList.add("hidden");
}
$("add-item-close").addEventListener("click", closeAddItemModal);
$("add-item-backdrop").addEventListener("click", closeAddItemModal);
$("add-item-submit").addEventListener("click", async () => {
  const name = $("item-name-input").value.trim();
  const link = $("item-link-input").value.trim();
  if (!name) { $("item-name-input").focus(); return; }

  let description = "";
  let image_url = null;

  // Ask the /api/scrape serverless function for a photo + description
  // from the link, if one was given. Falls back quietly if it's not
  // deployed yet or the fetch fails for any reason.
  if (link) {
    try {
      const res = await fetch("/api/scrape", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: link }),
      });
      if (res.ok) {
        const scraped = await res.json();
        description = scraped.description || "";
        image_url = scraped.image || null;
      }
    } catch (err) {
      // Scraper not available (e.g. running before this is deployed on Vercel) — that's fine.
    }
  }

  const { error } = await sb.from("wishlist_items").insert({
    group_id: currentGroupId,
    user_id: currentUser.id,
    name,
    description,
    link: link || null,
    image_url,
  });
  if (error) { alert("Couldn't add item: " + error.message); return; }

  $("item-name-input").value = "";
  $("item-link-input").value = "";
  closeAddItemModal();
  await loadWishlist(currentUser.id);
});
$("item-name-input").addEventListener("keydown", (e) => { if (e.key === "Enter") $("add-item-submit").click(); });
$("item-link-input").addEventListener("keydown", (e) => { if (e.key === "Enter") $("add-item-submit").click(); });

// ---------- Settings modal ----------
function skeletonSettingsRows() {
  const rowLabel = (text) => `<h4 style="font-size:0.78rem; text-transform:uppercase; letter-spacing:0.04em; color:var(--evergreen-dark); margin:0 0 8px;">${text}</h4>`;
  return `
    ${rowLabel("Theme")}
    <div class="skeleton-block line" style="height:38px; margin-bottom:18px;"></div>
    ${rowLabel("Your nickname in this group")}
    <div class="skeleton-block line" style="height:38px; margin-bottom:18px;"></div>
    ${rowLabel("Preferences")}
    <div class="skeleton-block line" style="height:38px; margin-bottom:8px;"></div>
    <div class="skeleton-block line" style="height:38px; margin-bottom:8px;"></div>
    <div class="skeleton-block line" style="height:38px; margin-bottom:18px;"></div>
    ${rowLabel("Notifications")}
    <div class="skeleton-block line" style="height:38px; margin-bottom:18px;"></div>
    ${rowLabel("Account")}
    <div class="skeleton-block line" style="height:38px; margin-bottom:8px;"></div>
    <div class="skeleton-block line" style="height:38px;"></div>
  `;
}

function renderSettingsContent() {
  const sectionLabel = (text, marginTop) => `<h4 style="font-size:0.78rem; text-transform:uppercase; letter-spacing:0.04em; color:var(--evergreen-dark); margin:${marginTop || 0}px 0 8px;">${text}</h4>`;
  const switchRow = (id, label, checked) => `
    <label class="settings-switch-row" style="margin-bottom:8px;">
      <span>${label}</span>
      <input type="checkbox" id="${id}" ${checked ? "checked" : ""} />
      <span class="switch-track"><span class="switch-thumb"></span></span>
    </label>`;

  const inGroup = !!currentGroupId;
  const me = currentMembers.find(m => m.user_id === (currentUser && currentUser.id));

  $("settings-modal-body").innerHTML = `
    ${sectionLabel("Theme")}
    <div class="theme-toggle" id="theme-toggle-modal">
      <button data-theme-choice="light">☀️ Light</button>
      <button data-theme-choice="dark">🌙 Dark</button>
      <button data-theme-choice="system">🖥️ System</button>
    </div>

    ${inGroup ? `
      ${sectionLabel("Your nickname in this group", 18)}
      <div class="nickname-editor">
        <input type="text" id="nickname-input" placeholder="Nickname in this group" value="${me ? escapeHtml(me.nickname) : ""}" />
        <button class="btn btn-ghost btn-small" id="nickname-save-btn">Save</button>
      </div>
    ` : ""}

    ${sectionLabel("Preferences", 18)}
    ${switchRow("pref-large-text", "Larger text", prefs.largeText)}
    ${switchRow("pref-compact-view", "Compact wishlist cards", prefs.compactView)}
    ${switchRow("pref-confirm-remove", "Confirm before removing an item", prefs.confirmRemove)}

    ${sectionLabel("Notifications", 18)}
    ${switchRow("notif-toggle", "Notify me when someone adds an item", true)}

    ${sectionLabel("Account", 18)}
    <button class="btn btn-ghost btn-small" style="width:100%; margin-bottom:8px;" id="settings-logout-btn">Log out</button>
    ${inGroup ? `<button class="btn btn-ghost btn-small" style="width:100%; color:var(--danger); border-color:var(--danger);" id="settings-leave-group-btn">Leave this group</button>` : ""}

    <p style="text-align:center; font-size:0.75rem; color:var(--evergreen-dark); margin:18px 0 0;">Wishlist</p>
  `;

  document.querySelectorAll('#theme-toggle-modal [data-theme-choice]').forEach(btn => {
    btn.addEventListener("click", () => setTheme(btn.dataset.themeChoice));
  });
  applyTheme(localStorage.getItem("wishlist-theme") || "system");

  $("pref-large-text").addEventListener("change", (e) => setPref("largeText", e.target.checked));
  $("pref-compact-view").addEventListener("change", (e) => setPref("compactView", e.target.checked));
  $("pref-confirm-remove").addEventListener("change", (e) => setPref("confirmRemove", e.target.checked));

  if (inGroup) {
    $("nickname-save-btn").addEventListener("click", async () => {
      const nickname = $("nickname-input").value.trim() || "You";
      const { error } = await sb
        .from("group_members")
        .update({ nickname })
        .eq("group_id", currentGroupId)
        .eq("user_id", currentUser.id);
      if (error) { alert("Couldn't save nickname: " + error.message); return; }
      await loadMembers();
    });

    $("settings-leave-group-btn").addEventListener("click", async () => {
      if (!confirm("Leave this group? You can rejoin later with the invite code.")) return;
      const { error } = await sb
        .from("group_members")
        .delete()
        .eq("group_id", currentGroupId)
        .eq("user_id", currentUser.id);
      if (error) { alert("Couldn't leave group: " + error.message); return; }
      closeSettingsModal();
      goToScreen("dashboard-screen");
      await loadGroups();
    });
  }

  $("settings-logout-btn").addEventListener("click", async () => {
    closeSettingsModal();
    await signOutEverywhere();
  });
}

function openSettingsModal() {
  $("settings-backdrop").classList.remove("hidden");
  $("settings-modal").classList.remove("hidden");
  $("settings-modal-body").innerHTML = skeletonSettingsRows();
  setTimeout(renderSettingsContent, 300);
}
function closeSettingsModal() {
  $("settings-backdrop").classList.add("hidden");
  $("settings-modal").classList.add("hidden");
}
$("settings-close").addEventListener("click", closeSettingsModal);
$("settings-backdrop").addEventListener("click", closeSettingsModal);

