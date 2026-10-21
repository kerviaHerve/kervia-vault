// Encrypted export bundles (KVX1): a passphrase-sealed backup of every
// vault. The passphrase — NOT the instance master key — seals the bundle, so
// the file restores into ANY fresh instance (DR semantics). Same KDF family
// as the coffre: PBKDF2-SHA256, 600k iterations, AES-256-GCM.
//
// Format: "KVX1" (4) | salt (16) | nonce (12) | ciphertext.
//
// SPDX-License-Identifier: AGPL-3.0

package crypto

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"errors"
	"io"

	"golang.org/x/crypto/pbkdf2"
)

// ExportMagic identifie le format de bundle.
const ExportMagic = "KVX1"

const (
	exportSaltLen   = 16
	exportNonceLen  = 12
	exportKDFIters  = 600_000 // mêmes paramètres que le coffre (WebCrypto)
	exportKeyLen    = 32      // AES-256
	exportOverhead  = len(ExportMagic) + exportSaltLen + exportNonceLen
)

// SealExport chiffre plaintext sous la passphrase de l'admin.
func SealExport(passphrase string, plaintext []byte) ([]byte, error) {
	if len(passphrase) < 12 {
		return nil, errors.New("crypto: export passphrase too short (min 12)")
	}
	salt := make([]byte, exportSaltLen)
	if _, err := io.ReadFull(rand.Reader, salt); err != nil {
		return nil, err
	}
	key := pbkdf2.Key([]byte(passphrase), salt, exportKDFIters, exportKeyLen, sha256.New)
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	nonce := make([]byte, exportNonceLen)
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return nil, err
	}
	ct := gcm.Seal(nil, nonce, plaintext, []byte(ExportMagic)) // AAD = le magic
	out := make([]byte, 0, exportOverhead+len(ct))
	out = append(out, ExportMagic...)
	out = append(out, salt...)
	out = append(out, nonce...)
	return append(out, ct...), nil
}

// OpenExport déchiffre un bundle KVX1. Une passphrase fausse ou un fichier
// corrompu échouent pareil — le GCM authentifie.
func OpenExport(passphrase string, blob []byte) ([]byte, error) {
	if len(blob) < exportOverhead+1 || string(blob[:len(ExportMagic)]) != ExportMagic {
		return nil, errors.New("crypto: not a KVX1 bundle")
	}
	salt := blob[len(ExportMagic) : len(ExportMagic)+exportSaltLen]
	off := len(ExportMagic) + exportSaltLen
	nonce := blob[off : off+exportNonceLen]
	ct := blob[off+exportNonceLen:]
	key := pbkdf2.Key([]byte(passphrase), salt, exportKDFIters, exportKeyLen, sha256.New)
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	pt, err := gcm.Open(nil, nonce, ct, []byte(ExportMagic))
	if err != nil {
		return nil, errors.New("crypto: wrong passphrase or corrupted bundle")
	}
	return pt, nil
}