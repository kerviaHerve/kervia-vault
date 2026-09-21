// Kervia-vault webui — interactions. No framework, no build step.
// All mutations go through /admin/* (session cookie auth, same-origin).

var ui = (function () {
  "use strict";

  // ---------- helpers ----------

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function toast(msg, kind) {
    kind = kind || "";
    var t = document.createElement("div");
    t.className = "toast " + kind;
    t.textContent = msg;
    document.getElementById("toasts").appendChild(t);
    setTimeout(function () { t.remove(); }, 3500);
  }

  function closeModal() {
    var m = document.getElementById("modal");
    if (m) m.innerHTML = "";
  }

  function openModal(inner) {
    document.getElementById("modal").innerHTML =
      '<div class="modal-backdrop" onclick="if(event.target===this)ui.closeModal()"><div class="modal">' +
      inner +
      "</div></div>";
  }

  function modalShell(title, body, foot) {
    return (
      '<div class="modal-head"><div class="modal-title">' +
      title +
      '</div><button class="btn ghost small" onclick="ui.closeModal()">✕</button></div>' +
      '<div class="modal-body">' +
      body +
      '</div><div class="modal-foot">' +
      foot +
      "</div>"
    );
  }

  function api(method, url, body) {
    var opts = { method: method, credentials: "same-origin" };
    if (body !== undefined) {
      opts.headers = { "Content-Type": "application/json" };
      opts.body = JSON.stringify(body);
    }
    return fetch(url, opts).then(function (r) {
      if (!r.ok && r.status !== 409) {
        return r.json().then(function (d) {
          throw new Error(d.message || d.error || r.status);
        });
      }
      return r.json().catch(function () { return {}; });
    });
  }

  // ---------- agents ----------

  function newAgent() {
    openModal(
      modalShell(
        "Nouvel agent",
        '<div class="field"><label>Nom de l\'agent</label>' +
          '<input id="agent-name" placeholder="rita, ci-runner, hermes-1…"></div>',
        '<button class="btn" onclick="ui.closeModal()">Annuler</button>' +
          '<button class="btn primary" onclick="ui.createAgent()">Créer</button>'
      )
    );
    setTimeout(function () { document.getElementById("agent-name").focus(); }, 30);
  }

  function createAgent() {
    var name = document.getElementById("agent-name").value.trim();
    if (!name) { toast("Nom requis", "error"); return; }
    api("POST", "/admin/agents", { name: name })
      .then(function (d) {
        if (d.error) { toast(d.message || d.error, "error"); return; }
        closeModal();
        showKeyModal(d.agent.name, d.api_key);
      })
      .catch(function (e) { toast(String(e.message || e), "error"); });
  }

  function showKeyModal(name, key) {
    openModal(
      modalShell(
        "Clé API créée — " + esc(name),
        '<div class="key-reveal" id="the-key">' + esc(key) + "</div>" +
          '<div class="flex">' +
          '<button class="btn" onclick="ui.copyKey()">⧉ Copier</button>' +
          '<span class="t2" style="font-size:12px">À coller dans la config de l\'agent (KERVIA_VAULT_API_KEY)</span>' +
          "</div>" +
          '<div class="key-warning">⚠ Cette clé ne sera <strong>jamais</strong> ré-affichée. Copiez-la maintenant.</div>',
        '<button class="btn primary" onclick="ui.closeModal(); location.reload()">J\'ai copié la clé</button>'
      )
    );
  }

  function copyKey() {
    navigator.clipboard
      .writeText(document.getElementById("the-key").textContent)
      .then(function () { toast("Clé copiée", "success"); });
  }

  function revokeAgent(id, name) {
    if (!confirm("Révoquer " + name + " ? Son accès cessera immédiatement.")) return;
    api("POST", "/admin/agents/" + id + "/revoke")
      .then(function () { toast(name + " révoqué", "success"); setTimeout(function () { location.reload(); }, 600); })
      .catch(function (e) { toast(String(e), "error"); });
  }

  // ---------- vaults ----------

  function newVault() {
    openModal(
      modalShell(
        "Nouveau vault",
        '<div class="field"><label>Nom du vault</label>' +
          '<input id="vault-name" placeholder="rita, ci, commun…"></div>',
        '<button class="btn" onclick="ui.closeModal()">Annuler</button>' +
          '<button class="btn primary" onclick="ui.createVault()">Créer</button>'
      )
    );
    setTimeout(function () { document.getElementById("vault-name").focus(); }, 30);
  }

  function createVault() {
    var name = document.getElementById("vault-name").value.trim();
    if (!name) { toast("Nom requis", "error"); return; }
    api("POST", "/admin/vaults", { name: name })
      .then(function (d) {
        if (d.error) { toast(d.message || d.error, "error"); return; }
        closeModal();
        toast("Vault « " + d.name + " » créé", "success");
        setTimeout(function () { location.reload(); }, 500);
      })
      .catch(function (e) { toast(String(e), "error"); });
  }

  // ---------- secrets ----------

  function parseTemplates() {
    var el = document.getElementById("page-data");
    if (!el) return {};
    try { return JSON.parse(el.dataset.templates || "{}"); } catch (e) { return {}; }
  }

  function currentVault() {
    var el = document.getElementById("page-data");
    return el ? el.dataset.vault : "";
  }

  function newSecret() {
    var tpls = parseTemplates();
    var options = '<option value="">— Valeur libre —</option>';
    tpls.forEach(function (t) {
      options += '<option value="' + esc(t.key) + '">' + esc(t.name) + " (" + esc(t.category) + ")</option>";
    });
    openModal(
      modalShell(
        "Nouveau secret dans « " + esc(currentVault()) + " »",
        '<div class="field"><label>Type de credential</label>' +
          '<select id="sec-template" onchange="ui.renderFields()">' + options + "</select>" +
          '<div class="help">Les templates valident les champs (openai, postgres, smtp…).</div></div>' +
          '<div id="tpl-fields"></div>' +
          '<div class="field"><label>Nom du secret (KEY)</label>' +
          '<input id="sec-key" class="mono" placeholder="PROD_DB, OPENAI_KEY…"></div>' +
          '<div id="free-field"><div class="field"><label>Valeur</label>' +
          '<input id="sec-value" class="mono" placeholder="le secret lui-même"></div></div>',
        '<button class="btn" onclick="ui.closeModal()">Annuler</button>' +
          '<button class="btn primary" onclick="ui.createSecret()">Créer</button>'
      )
    );
    setTimeout(function () { document.getElementById("sec-key").focus(); }, 30);
  }

  function renderFields() {
    var key = document.getElementById("sec-template").value;
    var holder = document.getElementById("tpl-fields");
    var free = document.getElementById("free-field");
    free.style.display = key ? "none" : "";
    if (!key) { holder.innerHTML = ""; return; }
    var tpls = parseTemplates();
    var t = tpls.find(function (x) { return x.key === key; });
    if (!t) { holder.innerHTML = ""; return; }
    var html = "";
    t.fields.forEach(function (f) {
      var type = f.type === "password" ? "password" : f.type === "textarea" ? "textarea" : "text";
      var input =
        type === "textarea"
          ? '<textarea id="f-' + esc(f.name) + '" class="mono" rows="4" placeholder="' + esc(f.placeholder || "") + '"></textarea>'
          : '<input id="f-' + esc(f.name) + '" type="' + type + '" placeholder="' + esc(f.placeholder || "") + '">';
      html +=
        '<div class="field"><label>' + esc(f.label) +
        (f.required ? ' <span style="color:var(--danger)">*</span>' : "") +
        "</label>" + input +
        (f.help ? '<div class="help">' + esc(f.help) + "</div>" : "") +
        "</div>";
    });
    holder.innerHTML = html;
  }

  function createSecret() {
    var vault = currentVault();
    var key = document.getElementById("sec-key").value.trim();
    if (!key) { toast("Nom du secret requis", "error"); return; }
    var tpl = document.getElementById("sec-template").value;
    var body = { vault: vault, key: key };
    if (tpl) {
      var tpls = parseTemplates();
      var t = tpls.find(function (x) { return x.key === tpl; });
      body.template = tpl;
      body.values = {};
      var missing = [];
      t.fields.forEach(function (f) {
        var el = document.getElementById("f-" + f.name);
        if (el && el.value !== "") body.values[f.name] = el.value;
        if (f.required && (!el || el.value === "")) missing.push(f.label);
      });
      if (missing.length) {
        toast("Champs requis manquants : " + missing.join(", "), "error");
        return;
      }
    } else {
      body.value = document.getElementById("sec-value").value;
      if (!body.value) { toast("Valeur requise", "error"); return; }
    }
    api("POST", "/admin/secrets", body)
      .then(function (d) {
        if (d.error) { toast(d.message || d.error, "error"); return; }
        closeModal();
        toast("Secret créé", "success");
        setTimeout(function () { location.reload(); }, 400);
      })
      .catch(function (e) { toast(String(e), "error"); });
  }

  function reveal(id, btn) {
    var el = document.getElementById("v-" + id);
    api("GET", "/admin/secrets/reveal?id=" + id)
      .then(function (d) {
        if (d.error) { toast("Accès refusé", "error"); return; }
        el.textContent = d.value;
        el.classList.add("visible");
        el.title = d.value;
        btn.textContent = "masquer";
        btn.onclick = function () {
          el.textContent = "••••••••••••";
          el.classList.remove("visible");
          el.removeAttribute("title");
          btn.textContent = "révéler";
          btn.onclick = function () { ui.reveal(id, btn); };
        };
      })
      .catch(function (e) { toast(String(e), "error"); });
  }

  function delSecret(id, key) {
    if (!confirm("Supprimer " + key + " ?")) return;
    api("POST", "/admin/secrets/" + id + "/delete")
      .then(function () { toast("Supprimé", "success"); setTimeout(function () { location.reload(); }, 400); })
      .catch(function (e) { toast(String(e), "error"); });
  }

  // ---------- grants matrix ----------

  function cycle(agent, vault, to) {
    if (to === "none") {
      api("DELETE", "/admin/grants", { agent_id: agent, vault_id: vault })
        .then(function () { location.reload(); });
    } else {
      api("POST", "/admin/grants", { agent_id: agent, vault_id: vault, can_write: to === "rw" })
        .then(function () { location.reload(); });
    }
  }

  return {
    newAgent: newAgent, createAgent: createAgent, revokeAgent: revokeAgent,
    copyKey: copyKey,
    newVault: newVault, createVault: createVault,
    newSecret: newSecret, createSecret: createSecret, renderFields: renderFields,
    reveal: reveal, delSecret: delSecret,
    cycle: cycle,
    closeModal: closeModal,
  };
})();