// Import subcommand: restore a KVX1 export bundle into a (fresh) instance.
//
// Usage:
//
//	KERVIA_VAULT_DB=/path/fresh.db \
//	KERVIA_VAULT_MASTER_KEY=<64 hex> \
//	KERVIA_VAULT_IMPORT_PASS=<passphrase du bundle> \
//	kervia-vault import vault.kvx
//
// DR semantics: the target instance must be FRESH — a vault name collision
// stops the import (fail-closed, no silent merge). Values are re-sealed with
// the TARGET master key; the passphrase only opens the bundle.
//
// SPDX-License-Identifier: AGPL-3.0

package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"

	"github.com/google/uuid"

	"github.com/kerviaHerve/kervia-vault/internal/crypto"
	"github.com/kerviaHerve/kervia-vault/internal/store"
)

// exportedPayload mirrors internal/api's exportPayload — same JSON shape,
// duplicated on purpose: the CLI must NOT import the api package.
type exportedPayload struct {
	Format     int               `json:"format"`
	ExportedAt string            `json:"exported_at"`
	Vaults     []exportedVault2 `json:"vaults"`
}

type exportedVault2 struct {
	Name    string            `json:"name"`
	Secrets []exportedSecret2 `json:"secrets"`
}

type exportedSecret2 struct {
	Key       string `json:"key"`
	Template  string `json:"template,omitempty"`
	Value     string `json:"value"`
	CreatedBy string `json:"created_by"`
	UpdatedAt string `json:"updated_at"`
}

func runImport(args []string) {
	if len(args) != 1 {
		fmt.Fprintln(os.Stderr, "usage: kervia-vault import <bundle.kvx>")
		fmt.Fprintln(os.Stderr, "env requis : KERVIA_VAULT_DB, KERVIA_VAULT_MASTER_KEY, KERVIA_VAULT_IMPORT_PASS")
		os.Exit(2)
	}
	dbPath := os.Getenv("KERVIA_VAULT_DB")
	masterKey := os.Getenv("KERVIA_VAULT_MASTER_KEY")
	pass := os.Getenv("KERVIA_VAULT_IMPORT_PASS")
	if dbPath == "" || masterKey == "" || pass == "" {
		fmt.Fprintln(os.Stderr, "KERVIA_VAULT_DB, KERVIA_VAULT_MASTER_KEY et KERVIA_VAULT_IMPORT_PASS sont requis")
		os.Exit(2)
	}

	blob, err := os.ReadFile(args[0]) // #nosec G304,G703 -- the path IS the user's argv: importing a file the operator names is the feature, not a traversal risk
	if err != nil {
		fmt.Fprintln(os.Stderr, "lecture:", err)
		os.Exit(1)
	}
	raw, err := crypto.OpenExport(pass, blob)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	var payload exportedPayload
	if err := json.Unmarshal(raw, &payload); err != nil || payload.Format != 1 {
		fmt.Fprintln(os.Stderr, "bundle invalide (format != 1)")
		os.Exit(1)
	}

	enc, err := crypto.NewEncryptorFromHex(masterKey)
	if err != nil {
		fmt.Fprintln(os.Stderr, "master key invalide:", err)
		os.Exit(1)
	}
	// la cible peut être un chemin neuf : le serveur fait MkdirAll, la CLI aussi
	if dir := filepath.Dir(dbPath); dir != "" && dir != "." {
		if err := os.MkdirAll(dir, 0o700); err != nil {
			fmt.Fprintln(os.Stderr, "répertoire cible:", err)
			os.Exit(1)
		}
	}
	st, err := store.Open(dbPath)
	if err != nil {
		fmt.Fprintln(os.Stderr, "base cible:", err)
		os.Exit(1)
	}

	vaultCount, secretCount := 0, 0
	for _, ev := range payload.Vaults {
		vaultID := uuid.NewString()
		if _, err := st.CreateVault(vaultID, ev.Name); err != nil {
			fmt.Fprintf(os.Stderr, "vault %q : %v — l'instance cible doit être NEUVE (pas de fusion)\n", ev.Name, err)
			os.Exit(1)
		}
		vaultCount++
		for _, es := range ev.Secrets {
			nonce, ct, err := enc.Encrypt([]byte(es.Value))
			if err != nil {
				fmt.Fprintln(os.Stderr, "chiffrement:", err)
				os.Exit(1)
			}
			if _, err := st.CreateSecret(uuid.NewString(), vaultID, es.Key, es.Template, nonce, ct, uuid.NewString(), "import"); err != nil {
				fmt.Fprintf(os.Stderr, "secret %q : %v\n", es.Key, err)
				os.Exit(1)
			}
			secretCount++
		}
	}
	fmt.Printf("import terminé : %d vaults, %d secrets (exporté le %s)\n", vaultCount, secretCount, payload.ExportedAt)
}