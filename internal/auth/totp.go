// TOTP (RFC 6238) : second facteur sur le login admin.
//
// Design :
//   - seed = 20 octets aléatoires, encodé base32 (secret otpauth standard)
//   - HMAC-SHA1, 6 chiffres, pas de 30 s, tolérance ±1 pas (dérive d'horloge)
//   - enrôlement en deux temps : seed pending → confirmation par un code
//     valide → actif. Le TOTP n'est exigé au login qu'une fois ACTIF.
//   - stockage : fichier à côté de la DB (0600), même modèle que le hash
//     admin et les codes de récupération — lecture à la demande, le bcrypt
//     domine de toute façon le coût d'un login.
//   - une récupération par code réinitialise AUSSI le TOTP : perte du
//     téléphone → reset du mot de passe → ré-enrôlement du 2FA.
//
// SPDX-License-Identifier: AGPL-3.0

package auth

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha1" // #nosec G505 -- RFC 6238 TOTP mandates HMAC-SHA1; SHA-1's collision weakness is irrelevant to a 30-second HMAC challenge
	"crypto/subtle"
	"encoding/base32"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const (
	totpStep   = 30 * time.Second
	totpDigits = 6
	totpWindow = 1 // ±1 pas de tolérance sur la dérive d'horloge
)

// b32Std : base32 sans padding — l'encodage standard des secrets otpauth.
var b32Std = base32.StdEncoding.WithPadding(base32.NoPadding)

// totpActivePath / totpPendingPath : fichiers de state, à côté du hash admin.
func totpActivePath() string { return filepath.Join(filepath.Dir(adminHashPath), "admin_totp") }
func totpPendingPath() string { return filepath.Join(filepath.Dir(adminHashPath), "admin_totp.pending") }

// GenerateTotpSeed : 20 octets CSPRNG → base32 (32 caractères, format otpauth).
func GenerateTotpSeed() (string, error) {
	raw := make([]byte, 20)
	if _, err := io.ReadFull(rand.Reader, raw); err != nil {
		return "", err
	}
	return b32Std.EncodeToString(raw), nil
}

// TotpURI construit l'URI otpauth:// pour l'import dans une app TOTP.
func TotpURI(seed string) string {
	return "otpauth://totp/Kervia-vault:admin?secret=" + seed + "&issuer=Kervia-vault"
}

// totpAt calcule le code RFC 6238 du seed au temps t.
func totpAt(seed string, t time.Time) (string, error) {
	key, err := b32Std.DecodeString(strings.ToUpper(strings.TrimSpace(seed)))
	if err != nil {
		return "", err
	}
	sec := t.Unix()
	if sec < 0 {
		sec = 0 // pre-epoch timestamps have no TOTP meaning — clamp, don't overflow
	}
	counter := uint64(sec) / uint64(totpStep/time.Second)
	buf := make([]byte, 8)
	binary.BigEndian.PutUint64(buf, counter)
	mac := hmac.New(sha1.New, key) // #nosec G304 -- RFC 6238 mandates SHA-1 here
	mac.Write(buf)
	sum := mac.Sum(nil)
	offset := sum[len(sum)-1] & 0xf
	val := binary.BigEndian.Uint32(sum[offset:offset+4]) & 0x7fffffff
	return fmt.Sprintf("%0*d", totpDigits, int(val)%1_000_000), nil
}

// VerifyTotp : code à ±totpWindow pas près du maintenant. Comparaison à temps
// constant — un code est un secret de 6 chiffres, pas un entier ordinaire.
func VerifyTotp(seed, code string) bool {
	code = strings.TrimSpace(code)
	if len(code) != totpDigits {
		return false
	}
	now := time.Now()
	for i := -totpWindow; i <= totpWindow; i++ {
		want, err := totpAt(seed, now.Add(time.Duration(i)*totpStep))
		if err != nil {
			return false
		}
		if subtle.ConstantTimeCompare([]byte(want), []byte(code)) == 1 {
			return true
		}
	}
	return false
}

// totpRead lit le seed d'un fichier de state ("" si absent).
func totpRead(path string) string {
	b, err := os.ReadFile(path) // #nosec G304 -- chemin fixe à côté de la DB, 0600
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(b))
}

func totpWrite(path, seed string) error {
	return os.WriteFile(path, []byte(seed), 0o600) // #nosec G306 -- credential material
}

// TOTPState : "none" | "pending" | "active" — affiché par la page Settings.
func (s *Service) TOTPState() string {
	switch {
	case totpRead(totpActivePath()) != "":
		return "active"
	case totpRead(totpPendingPath()) != "":
		return "pending"
	default:
		return "none"
	}
}

// TOTPRequired : le login exige-t-il un second facteur ?
func (s *Service) TOTPRequired() bool { return totpRead(totpActivePath()) != "" }

// TOTPCheck valide un code contre le seed ACTIF.
func (s *Service) TOTPCheck(code string) bool {
	seed := totpRead(totpActivePath())
	return seed != "" && VerifyTotp(seed, code)
}

// TOTPEnroll génère un seed PENDING (affiché une seule fois au webui).
// Réenroller écrase le pending précédent — un enrôlement non confirmé n'a
// aucune valeur de sécurité. Un TOTP ACTIF refuse : désactiver d'abord
// (défense en profondeur, le handler vérifie aussi).
func (s *Service) TOTPEnroll() (seed, uri string, err error) {
	if s.TOTPRequired() {
		return "", "", errors.New("auth: totp already active — disable first")
	}
	seed, err = GenerateTotpSeed()
	if err != nil {
		return "", "", err
	}
	if err := totpWrite(totpPendingPath(), seed); err != nil {
		return "", "", err
	}
	return seed, TotpURI(seed), nil
}

// TOTPConfirm active le seed pending — un code valide prouve que la seed est
// bien dans l'app TOTP de l'admin. Un TOTP déjà actif ne se ré-enrôle pas :
// désactiver d'abord (double facteur exigé).
func (s *Service) TOTPConfirm(code string) error {
	pending := totpRead(totpPendingPath())
	if pending == "" {
		return errors.New("auth: no pending enrollment")
	}
	if s.TOTPRequired() {
		return errors.New("auth: totp already active — disable first")
	}
	if !VerifyTotp(pending, code) {
		return errors.New("auth: invalid code")
	}
	if err := os.Rename(totpPendingPath(), totpActivePath()); err != nil {
		return err
	}
	return nil
}

// TOTPDisable retire le TOTP actif — le code actif est exigé (le mot de passe
// est vérifié par le handler, qui exige les DEUX facteurs pour retirer).
func (s *Service) TOTPDisable(code string) bool {
	if !s.TOTPRequired() {
		return false
	}
	if !s.TOTPCheck(code) {
		return false
	}
	_ = os.Remove(totpActivePath())
	return true
}

// totpReset supprime pending et actif — appelé par la récupération par code :
// un reset de mot de passe est l'issue de secours d'un téléphone perdu.
func (s *Service) totpReset() {
	_ = os.Remove(totpActivePath())
	_ = os.Remove(totpPendingPath())
}