// Admin export: a passphrase-sealed KVX1 bundle of every vault — the DR
// artifact. The passphrase travels in the request body (session-guarded),
// the bundle downloads as an attachment. The audit records THAT an export
// happened, never a passphrase or any secret content.
//
// SPDX-License-Identifier: AGPL-3.0

package api

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/kerviaHerve/kervia-vault/internal/crypto"
	"github.com/kerviaHerve/kervia-vault/internal/model"
)

// exportPayload : structure du JSON scellé dans le bundle. Les valeurs sont
// en clair DANS le bundle chiffré (re-scellées par la passphrase).
type exportPayload struct {
	Format     int             `json:"format"`
	ExportedAt string          `json:"exported_at"`
	Vaults     []exportedVault `json:"vaults"`
}

type exportedVault struct {
	Name    string          `json:"name"`
	Secrets []exportedSecret `json:"secrets"`
}

type exportedSecret struct {
	Key       string `json:"key"`
	Template  string `json:"template,omitempty"`
	Value     string `json:"value"`
	CreatedBy string `json:"created_by"`
	UpdatedAt string `json:"updated_at"`
}

// ExportHandler (admin) : POST /admin/export {passphrase} → fichier .kvx.
func (a *AdminServer) ExportHandler(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Passphrase string `json:"passphrase"`
	}
	if err := jsonBody(r, &req); err != nil || len(req.Passphrase) < 12 {
		writeErr(w, 400, "invalid_request", "12 caractères minimum pour la passphrase")
		return
	}

	vaults, err := a.store.ListVaults()
	if err != nil {
		writeErr(w, 500, "internal", "")
		return
	}
	payload := exportPayload{Format: 1, ExportedAt: time.Now().UTC().Format(time.RFC3339)}
	for _, v := range vaults {
		ev := exportedVault{Name: v.Name}
		secrets, err := a.store.ListSecretsByVault(v.ID)
		if err != nil {
			continue
		}
		for _, sec := range secrets {
			_, nonce, ct, err := a.store.GetSecretByID(sec.ID)
			if err != nil {
				continue
			}
			val, err := a.enc.Decrypt(nonce, ct)
			if err != nil {
				continue
			}
			ev.Secrets = append(ev.Secrets, exportedSecret{
				Key:       sec.Key,
				Template:  sec.Template,
				Value:     string(val),
				CreatedBy: sec.CreatedBy,
				UpdatedAt: sec.UpdatedAt.UTC().Format(time.RFC3339Nano),
			})
		}
		payload.Vaults = append(payload.Vaults, ev)
	}

	raw, err := json.MarshalIndent(payload, "", " ")
	if err != nil {
		writeErr(w, 500, "internal", "")
		return
	}
	blob, err := crypto.SealExport(req.Passphrase, raw)
	if err != nil {
		writeErr(w, 400, "invalid_request", err.Error())
		return
	}

	name := "kervia-vault-export-" + time.Now().Format("20060102-150405") + ".kvx"
	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Content-Disposition", `attachment; filename="`+name+`"`)
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	_, _ = w.Write(blob) // #nosec G104 -- download; the audit below is the durable trace
	_ = a.store.AppendAuditDetail("admin", model.AuditExport, "vaults/*",
		"bundle "+name, requestAuditInfo(r, 200))
}