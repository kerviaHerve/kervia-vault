// Export bundle (KVX1) tests: round-trip, wrong passphrase, corruption.
// SPDX-License-Identifier: AGPL-3.0

package crypto

import "testing"

func TestExportRoundTrip(t *testing.T) {
	plain := []byte(`{"format":1,"vaults":[{"name":"hermes","secrets":[{"key":"api","value":"tok"}]}]}`)
	blob, err := SealExport("correct horse battery staple", plain)
	if err != nil {
		t.Fatal(err)
	}
	got, err := OpenExport("correct horse battery staple", blob)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != string(plain) {
		t.Fatal("round-trip mismatch")
	}
	// wrong passphrase → uniform failure (GCM authenticates)
	if _, err := OpenExport("wrong passphrase here!!", blob); err == nil {
		t.Fatal("wrong passphrase must fail")
	}
	// corrupted blob → failure
	blob[len(blob)-3] ^= 0xff
	if _, err := OpenExport("correct horse battery staple", blob); err == nil {
		t.Fatal("corrupted bundle must fail")
	}
	// too-short passphrase refused at seal time
	if _, err := SealExport("short", plain); err == nil {
		t.Fatal("short passphrase must be refused")
	}
}