// ============================================================
// Wishlist — app logic.
// Real Supabase auth, groups, members, and wishlist items.
// (Theme/preferences/skeleton/drawer/modal UI below is unchanged
// from the original prototype; only the data layer is new.)
// ============================================================

const $ = (id) => document.getElementById(id);

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ---------- App state ----------
let currentUser = null;         // { id, email, firstName, lastName }
let currentGroupId = null;      // uuid of the group currently open
let currentGroupName = "";
let currentGroupOwnerId = null; // uuid of the group's creator (owner)
let currentMembers = [];        // [{ user_id, nickname }]
let currentMemberId = null;     // whose wishlist is showing in group-screen

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
  // The drawer/settings/add-item overlays only make sense once you're
  // signed in and past the profile-completion gate -- close them on the
  // way to any other screen (start, auth, complete-profile).
  if (id !== "dashboard-screen" && id !== "group-screen") {
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
  const firstName = $("signup-first-name").value.trim();
  const lastName = $("signup-last-name").value.trim();
  const email = $("signup-email").value.trim();
  const password = $("signup-password").value;
  const confirm = $("signup-password-confirm").value;
  $("auth-error").textContent = "";
  if (!firstName || !lastName) {
    $("auth-error").textContent = "Enter your first and last name.";
    return;
  }
  if (password !== confirm) {
    $("auth-error").textContent = "Passwords don't match.";
    return;
  }
  const { data, error } = await sb.auth.signUp({
    email,
    password,
    options: { data: { first_name: firstName, last_name: lastName } },
  });
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

// ---------- Password reset (the other end of "Forgot password?") ----------
// Clicking the link in that email brings someone back here with a
// recovery token in the URL. Supabase's client picks that up on load,
// signs them into a temporary recovery session, and fires this event --
// that's the signal to show the "set a new password" screen instead of
// wherever the normal sign-in flow below would otherwise send them.
let inPasswordRecovery = false;
sb.auth.onAuthStateChange((event, session) => {
  if (event === "PASSWORD_RECOVERY" && session && session.user) {
    inPasswordRecovery = true;
    currentUser = { id: session.user.id, email: session.user.email };
    showResetPasswordScreen();
  }
});

function showResetPasswordScreen() {
  $("reset-password-error").textContent = "";
  $("reset-password-new").value = "";
  $("reset-password-confirm").value = "";
  goToScreen("reset-password-screen");
}

$("reset-password-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const newPassword = $("reset-password-new").value;
  const confirm = $("reset-password-confirm").value;
  $("reset-password-error").textContent = "";
  if (newPassword.length < 6) {
    $("reset-password-error").textContent = "Password must be at least 6 characters.";
    return;
  }
  if (newPassword !== confirm) {
    $("reset-password-error").textContent = "Passwords don't match.";
    return;
  }
  const { error } = await sb.auth.updateUser({ password: newPassword });
  if (error) {
    $("reset-password-error").textContent = "Couldn't update password: " + error.message;
    return;
  }
  inPasswordRecovery = false;
  await loadCurrentUserProfile();
  if (!hasCompleteProfile()) {
    showCompleteProfileScreen();
    return;
  }
  await enterDashboard();
});

// Shows the signed-in account's name in the drawer (this replaced the
// old header name+"Log out" badge -- the drawer is now the one place
// that shows who you're signed in as).
function setAccountName(text) {
  $("drawer-account-name").textContent = text || "";
}

// Look up the signed-in user's name (for the drawer and defaults
// elsewhere) now that accounts have real first/last names.
async function loadCurrentUserProfile() {
  const { data } = await sb
    .from("profiles")
    .select("first_name, last_name")
    .eq("id", currentUser.id)
    .maybeSingle();
  currentUser.firstName = data ? data.first_name : null;
  currentUser.lastName = data ? data.last_name : null;
  const fullName = [currentUser.firstName, currentUser.lastName].filter(Boolean).join(" ");
  setAccountName(fullName || currentUser.email);
}

async function signOutEverywhere() {
  await sb.auth.signOut();
  currentUser = null;
  currentGroupId = null;
  goToScreen("start-screen");
}

// Any account missing a first/last name (made before named accounts
// existed, or added to a group by name without ever signing up itself)
// has to fill that in before it can use the rest of the app.
function hasCompleteProfile() {
  return !!(currentUser && currentUser.firstName && currentUser.lastName);
}

async function onSignedIn(user) {
  currentUser = { id: user.id, email: user.email };
  await loadCurrentUserProfile();
  if (!hasCompleteProfile()) {
    showCompleteProfileScreen();
    return;
  }
  await enterDashboard();
}

// Resume an existing session on page load (so people don't have to
// sign in again every visit), otherwise stay on the start screen.
(async () => {
  // A password-recovery link is handled by the onAuthStateChange listener
  // above instead -- don't race it into the normal dashboard.
  if (window.location.hash.includes("type=recovery")) return;
  const { data } = await sb.auth.getSession();
  if (data.session && data.session.user && !inPasswordRecovery) {
    currentUser = { id: data.session.user.id, email: data.session.user.email };
    await loadCurrentUserProfile();
    if (!hasCompleteProfile()) {
      showCompleteProfileScreen();
      return;
    }
    await enterDashboard();
  }
})();

// ---------- Complete-your-profile gate ----------
function showCompleteProfileScreen() {
  $("complete-profile-error").textContent = "";
  $("complete-profile-first-name").value = currentUser.firstName || "";
  $("complete-profile-last-name").value = currentUser.lastName || "";
  goToScreen("complete-profile-screen");
}

$("complete-profile-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const firstName = $("complete-profile-first-name").value.trim();
  const lastName = $("complete-profile-last-name").value.trim();
  $("complete-profile-error").textContent = "";
  if (!firstName || !lastName) {
    $("complete-profile-error").textContent = "Enter your first and last name.";
    return;
  }
  const { error } = await sb
    .from("profiles")
    .update({ first_name: firstName, last_name: lastName })
    .eq("id", currentUser.id);
  if (error) {
    $("complete-profile-error").textContent = "Couldn't save: " + error.message;
    return;
  }
  currentUser.firstName = firstName;
  currentUser.lastName = lastName;
  setAccountName([firstName, lastName].join(" "));
  await enterDashboard();
});

$("complete-profile-logout").addEventListener("click", signOutEverywhere);

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
    grid.innerHTML = `<p class="empty-state">Sign in to see your real groups.</p>`;
    return;
  }

  const { data, error } = await sb
    .from("group_members")
    .select("nickname, groups ( id, name, invite_code, created_by )")
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
    <div class="group-tag" data-group-id="${g.id}" data-group-name="${escapeHtml(g.name)}" data-invite-code="${g.invite_code}" data-owner-id="${g.created_by || ""}">
      <h3>${escapeHtml(g.name)}</h3>
      <div class="invite-code">Invite code: ${g.invite_code}</div>
    </div>
  `).join("");
  attachGroupCardHandlers();
}

function attachGroupCardHandlers() {
  document.querySelectorAll(".group-tag").forEach(card => {
    card.addEventListener("click", () => {
      openGroup(card.dataset.groupId, card.dataset.groupName, card.dataset.inviteCode, card.dataset.ownerId);
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

    // No nickname override -- the display name falls back to the
    // member's real first/last name (set at sign-up).
    const { error: memberError } = await sb
      .from("group_members")
      .insert({ group_id: group.id, user_id: currentUser.id });
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
      .insert({ group_id: group.id, user_id: currentUser.id });
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
// Group screen — people list, then a person's wishlist
// ============================================================
function showMembersView() {
  $("group-members-view").classList.remove("hidden");
  $("group-wishlist-view").classList.add("hidden");
}
function showWishlistView() {
  $("group-members-view").classList.add("hidden");
  $("group-wishlist-view").classList.remove("hidden");
}

async function openGroup(groupId, groupName, inviteCode, ownerId) {
  currentGroupId = groupId;
  currentGroupName = groupName;
  currentGroupOwnerId = ownerId || null;
  $("group-view-title").textContent = groupName;
  $("group-invite-code").textContent = inviteCode ? `Invite code: ${inviteCode}` : "";
  $("owner-add-member").classList.toggle("hidden", !(currentUser && currentGroupOwnerId === currentUser.id));
  $("member-search-input").value = "";
  $("member-search-results").innerHTML = "";
  goToScreen("group-screen");
  showMembersView();
  await loadMembers();
}

async function loadMembers() {
  const { data, error } = await sb
    .from("group_members")
    .select("user_id, nickname, profiles ( first_name, last_name, email )")
    .eq("group_id", currentGroupId);

  const list = $("member-list");
  if (error) {
    list.innerHTML = `<li class="empty-state">Couldn't load members: ${error.message}</li>`;
    return;
  }

  currentMembers = (data || []).map(row => {
    const p = row.profiles || {};
    const fullName = [p.first_name, p.last_name].filter(Boolean).join(" ");
    return {
      user_id: row.user_id,
      nickname: row.nickname || fullName || p.email || "Member",
    };
  }).sort((a, b) => a.nickname.localeCompare(b.nickname, undefined, { sensitivity: "base" }));

  list.innerHTML = currentMembers.map(m => `
    <li data-member="${m.user_id}">
      ${escapeHtml(m.nickname)}${m.user_id === currentUser.id ? ' <span class="you-tag">(you)</span>' : ""}
    </li>
  `).join("");

  document.querySelectorAll("#member-list li").forEach(li => {
    li.addEventListener("click", () => selectMember(li.dataset.member));
  });
}

function selectMember(memberUserId) {
  showWishlistView();
  loadWishlist(memberUserId);
}

$("back-to-members").addEventListener("click", showMembersView);

// ---------- Owner-assisted "add someone by name" ----------
if ($("member-search-btn")) {
  $("member-search-btn").addEventListener("click", searchMembersByName);
}
if ($("member-search-input")) {
  $("member-search-input").addEventListener("keydown", (e) => { if (e.key === "Enter") searchMembersByName(); });
}

async function searchMembersByName() {
  const query = $("member-search-input").value.trim();
  const resultsList = $("member-search-results");
  if (!query) { resultsList.innerHTML = ""; return; }

  resultsList.innerHTML = `<li class="empty-state">Searching...</li>`;

  const { data, error } = await sb.rpc("search_profiles_by_name", { query });
  if (error) {
    resultsList.innerHTML = `<li class="empty-state">Couldn't search: ${error.message}</li>`;
    return;
  }

  const existingIds = new Set(currentMembers.map(m => m.user_id));
  const results = (data || []).filter(p => !existingIds.has(p.id));

  if (results.length === 0) {
    resultsList.innerHTML = `<li class="empty-state">No matches.</li>`;
    return;
  }

  resultsList.innerHTML = results.map(p => {
    const fullName = [p.first_name, p.last_name].filter(Boolean).join(" ") || p.email || "Member";
    return `<li>${escapeHtml(fullName)} <button class="btn btn-ghost btn-small" data-add-id="${p.id}">Add</button></li>`;
  }).join("");

  resultsList.querySelectorAll("[data-add-id]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const { error: addError } = await sb.rpc("add_group_member_by_id", {
        target_group_id: currentGroupId,
        target_user_id: btn.dataset.addId,
      });
      if (addError) { alert("Couldn't add: " + addError.message); return; }
      $("member-search-input").value = "";
      resultsList.innerHTML = "";
      await loadMembers();
    });
  });
}

async function loadWishlist(memberUserId) {
  currentMemberId = memberUserId;
  $("wishlist-items").innerHTML = skeletonItemCards(2);

  const member = currentMembers.find(m => m.user_id === memberUserId);
  $("wishlist-owner-heading").textContent =
    memberUserId === currentUser.id ? "Your wishlist" : `${member ? member.nickname : "Their"}'s wishlist`;

  // Read through wishlist_items_view (not the base table): it quietly
  // hides purchase status from the item's own owner, so the surprise
  // stays a surprise, while everyone else can see it.
  const { data, error } = await sb
    .from("wishlist_items_view")
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
    container.innerHTML = addButtonHtml + items.map(item => {
      // Purchase status is only ever shown to people other than the
      // item's own owner -- wishlist_items_view already nulls these
      // fields out for the owner, but we gate on isMine too so the
      // surprise stays hidden even if that ever changes.
      let purchaseHtml = "";
      if (!isMine) {
        // Checked via purchased_at, not purchased_by: if the person who
        // bought it later deletes their account, purchased_by is cleared
        // (so nobody's credited for it anymore) but the item should
        // still show as bought, not flip back to "Mark as bought".
        if (item.purchased_at) {
          const isBuyer = item.purchased_by === currentUser.id;
          const buyerName = [item.purchased_by_first_name, item.purchased_by_last_name].filter(Boolean).join(" ");
          purchaseHtml = `
            <div class="item-actions">
              <span class="bought-tag">&#10003; Bought${isBuyer ? " by you" : (buyerName ? " by " + escapeHtml(buyerName) : "")}</span>
              ${isBuyer ? `<button class="btn btn-ghost btn-small" data-unmark-id="${item.id}">Undo</button>` : ""}
            </div>`;
        } else {
          purchaseHtml = `<div class="item-actions"><button class="btn btn-gold btn-small" data-mark-id="${item.id}">Mark as bought</button></div>`;
        }
      }

      return `
        <div class="item-tag" data-item-id="${item.id}">
          <img src="${item.image_url || placeholderImageFor(item.name)}" alt="${escapeHtml(item.name)}" />
          <h4>${escapeHtml(item.name)}</h4>
          ${item.description ? `<p>${escapeHtml(item.description)}</p>` : ""}
          ${item.link ? `<a href="${item.link}" target="_blank" rel="noopener">View item &rarr;</a>` : ""}
          ${isMine ? `<div class="item-actions"><button class="btn btn-ghost btn-small" data-remove-id="${item.id}">Remove</button></div>` : ""}
          ${purchaseHtml}
        </div>
      `;
    }).join("");
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
  } else {
    container.querySelectorAll("[data-mark-id]").forEach(btn => {
      btn.addEventListener("click", async () => {
        const { error: markError } = await sb.rpc("mark_item_purchased", { target_item_id: btn.dataset.markId });
        if (markError) { alert("Couldn't mark as bought: " + markError.message); return; }
        await loadWishlist(memberUserId);
      });
    });
    container.querySelectorAll("[data-unmark-id]").forEach(btn => {
      btn.addEventListener("click", async () => {
        const { error: unmarkError } = await sb.rpc("unmark_item_purchased", { target_item_id: btn.dataset.unmarkId });
        if (unmarkError) { alert("Couldn't undo: " + unmarkError.message); return; }
        await loadWishlist(memberUserId);
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

// ---------- Right-side account/menu drawer ----------
function openDrawer() {
  $("member-drawer").classList.add("open");
  $("drawer-backdrop").classList.remove("hidden");
}
function closeDrawer() {
  $("member-drawer").classList.remove("open");
  $("drawer-backdrop").classList.add("hidden");
}
// The hamburger button is duplicated in each screen's own header (see
// index.html) rather than being one fixed overlay element, so every
// copy of it needs the same click handler.
document.querySelectorAll(".hamburger-btn").forEach(btn => {
  btn.addEventListener("click", openDrawer);
});
$("drawer-close").addEventListener("click", closeDrawer);
$("drawer-backdrop").addEventListener("click", closeDrawer);

$("drawer-settings-btn").addEventListener("click", () => {
  closeDrawer();
  openSettingsModal();
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
    <p style="font-size:0.85rem; margin:0 0 10px;">Signed in as <strong>${escapeHtml([currentUser.firstName, currentUser.lastName].filter(Boolean).join(" ") || currentUser.email)}</strong></p>
    <button class="btn btn-ghost btn-small" style="width:100%; margin-bottom:8px;" id="settings-logout-btn">Log out</button>
    ${inGroup ? `<button class="btn btn-ghost btn-small" style="width:100%; margin-bottom:8px; color:var(--danger); border-color:var(--danger);" id="settings-leave-group-btn">Leave this group</button>` : ""}

    <div id="delete-account-zone" style="margin-top:8px;"></div>

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
      // Leaving this blank clears the override, so the display name
      // falls back to the member's real first/last name again.
      const nickname = $("nickname-input").value.trim() || null;
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

  renderDeleteAccountInitial();
}

// ---------- Delete account (two-step confirmation, so no accidental
// deletes happen) ----------
function renderDeleteAccountInitial() {
  $("delete-account-zone").innerHTML = `
    <button class="btn btn-ghost btn-small" style="width:100%; color:var(--danger); border-color:var(--danger);" id="delete-account-btn">Delete account</button>
  `;
  $("delete-account-btn").addEventListener("click", renderDeleteAccountConfirm);
}

function renderDeleteAccountConfirm() {
  $("delete-account-zone").innerHTML = `
    <p style="font-size:0.8rem; color:var(--danger); margin:0 0 10px;">This permanently deletes your account: your wishlist items, and your membership in every group. Groups you created stay for everyone else, but you won't be part of them anymore. This can't be undone.</p>
    <div style="display:flex; gap:8px;">
      <button class="btn btn-ghost btn-small" style="flex:1;" id="delete-account-cancel">Cancel</button>
      <button class="btn btn-small" style="flex:1; background:var(--danger); color:#fff;" id="delete-account-confirm">Yes, delete my account</button>
    </div>
  `;
  $("delete-account-cancel").addEventListener("click", renderDeleteAccountInitial);
  $("delete-account-confirm").addEventListener("click", performAccountDeletion);
}

async function performAccountDeletion() {
  $("delete-account-zone").innerHTML = `<p style="font-size:0.85rem;">Deleting your account…</p>`;
  try {
    const { data: sessionData } = await sb.auth.getSession();
    const token = sessionData && sessionData.session && sessionData.session.access_token;
    if (!token) {
      alert("Your session has expired -- please sign in again before deleting your account.");
      renderDeleteAccountInitial();
      return;
    }

    const res = await fetch("/api/delete-account", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    });
    const result = await res.json().catch(() => ({}));

    if (!res.ok) {
      alert("Couldn't delete your account: " + (result.error || "unknown error"));
      renderDeleteAccountInitial();
      return;
    }

    closeSettingsModal();
    await sb.auth.signOut();
    currentUser = null;
    currentGroupId = null;
    goToScreen("start-screen");
    alert("Your account has been deleted.");
  } catch (err) {
    alert("Couldn't delete your account: " + err.message);
    renderDeleteAccountInitial();
  }
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
