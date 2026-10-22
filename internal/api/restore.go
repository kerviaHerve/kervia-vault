// Webui restore: upload a KVX1 bundle and bring missing vaults back.
//
// Semantics — deliberately conservative, consistent with the product's
// append-only philosophy: NOTHING is ever overwritten. Vault names present
// in the bundle that already exist are SKIPPED (reported); missing vaults
// are created with their secrets, values re-sealed with the INSTANCE master
// key. Two steps: dry-run (verify + report) then import.
//
// SPDX-License-Identifier: AGPL-3.0

package api

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"

	"github.com/google/uuid"

	"github.com/kerviaHerve/kervia-vault/internal/crypto"
	"github.com/kerviaHerve/kervia-vault/internal/model"
)

// restoreVaultReport : ce que contient le bundle (dry-run) ou ce que
// l'import a fait — jamais de valeurs, uniquement des noms et des comptes.
type restoreVaultReport struct {
	Name    string `json:"name"`
	Secrets int    `json:"secrets"`
	Status  string `json:"status"` // imported | skipped
}

// RestoreHandler (admin) : POST /admin/restore — multipart (bundle, pass).
// ?dry_run=1 → vérification seule : déchiffre, liste, n'écrit RIEN.
func (a *AdminServer) RestoreHandler(w http.ResponseWriter, r *http.Request) {
	// limite dure AVANT tout parsing — le corps ne peut pas dépasser en mémoire
	r.Body = http.MaxBytesReader(w, r.Body, 32<<20)
	if err := r.ParseMultipartForm(32 << 20); err != nil { // #nosec G120 -- body already capped by http.MaxBytesReader above; the form ceiling matches it (32 MiB)
		writeErr(w, 400, "invalid_request", "fichier manquant ou trop lourd (32 Mo max)")
		return
	}
	pass := r.FormValue("pass")
	if len(pass) < 12 {
		writeErr(w, 400, "invalid_request", "12 caractères minimum pour la passphrase")
		return
	}
	f, _, err := r.FormFile("bundle")
	if err != nil {
		writeErr(w, 400, "invalid_request", "fichier manquant ou trop lourd (32 Mo max)")
		return
	}
	defer func() { _ = f.Close() }()
	blob, err := io.ReadAll(io.LimitReader(f, 32<<20))
	if err != nil {
		writeErr(w, 400, "invalid_request", "")
		return
	}

	// ouverture du bundle — passphrase fausse ou fichier corrompu : même erreur
	raw, err := crypto.OpenExport(pass, blob)
	if err != nil {
		_ = a.store.AppendAudit("admin", model.AuditRestoreVerify, "restore", "fail: " + err.Error())
		writeErr(w, 400, "invalid_bundle", "passphrase incorrecte ou bundle corrompu")
		return
	}
	var payload exportPayload
	if err := json.Unmarshal(raw, &payload); err != nil || payload.Format != 1 {
		writeErr(w, 400, "invalid_bundle", "")
		return
	}
	if len(payload.Vaults) == 0 {
		writeErr(w, 400, "empty_bundle", "")
		return
	}

	dryRun := r.URL.Query().Get("dry_run") == "1"

	// ── dry-run : inventaire, aucune écriture ──────────────────────────
	if dryRun {
		reports := make([]restoreVaultReport, 0, len(payload.Vaults))
		for _, ev := range payload.Vaults {
			_, err := a.store.GetVaultByName(ev.Name)
			status := "imported" // sec : n'existe pas → sera importé
			if err == nil {
				status = "skipped" // existe déjà → ne sera PAS touché
			}
			reports = append(reports, restoreVaultReport{Name: ev.Name, Secrets: len(ev.Secrets), Status: status})
		}
		_ = a.store.AppendAudit("admin", model.AuditRestoreVerify, "restore", fmt.Sprintf("ok: %d vaults", len(payload.Vaults)))
		writeJSON(w, 200, map[string]any{
			"exported_at": payload.ExportedAt,
			"vaults":      reports,
		})
		return
	}

	// ── import : ne restaure que les vaults MANQUANTS, jamais un écrasement ──
	reports := make([]restoreVaultReport, 0, len(payload.Vaults))
	imported, total := 0, 0
	for _, ev := range payload.Vaults {
		if _, err := a.store.GetVaultByName(ev.Name); err == nil {
			reports = append(reports, restoreVaultReport{Name: ev.Name, Secrets: len(ev.Secrets), Status: "skipped"})
			continue
		}
		vaultID := uuid.NewString()
		if _, err := a.store.CreateVault(vaultID, ev.Name); err != nil {
			writeErr(w, 500, "internal", "")
			return
		}
		n := 0
		for _, es := range ev.Secrets {
			nonce, ct, err := a.enc.Encrypt([]byte(es.Value))
			if err != nil {
				continue // fail-safe sur l'entrée : on n'interrompt pas tout le vault
			}
			if _, err := a.store.CreateSecret(uuid.NewString(), vaultID, es.Key, es.Template, nonce, ct, uuid.NewString(), "restore"); err != nil {
				continue
			}
			n++
		}
		imported++
		total += n
		reports = append(reports, restoreVaultReport{Name: ev.Name, Secrets: n, Status: "imported"})
	}
	_ = a.store.AppendAuditDetail("admin", model.AuditRestoreImport, "restore",
		fmt.Sprintf("%d vaults, %d secrets", imported, total), requestAuditInfo(r, 200))
	writeJSON(w, 200, map[string]any{
		"vaults":           reports,
		"imported_vaults":  imported,
		"imported_secrets": total,
	})
}