// Template registry — Network / VPN (accès réseau privé).
//
// SPDX-License-Identifier: AGPL-3.0

package templates

func init() {
	register(
		Template{
			Key: "wireguard", Name: "WireGuard", Category: "Network",
			Description: "WireGuard interface credentials (peer).",
			Fields: []Field{
				{Name: "private_key", Label: "Interface private key", Type: TypePassword, Required: true,
					Help: "base64, 44 chars — rotate it if ever exposed"},
				{Name: "peer_public_key", Label: "Peer public key", Type: TypeText, Required: false},
				{Name: "endpoint", Label: "Peer endpoint", Type: TypeText, Required: false,
					Placeholder: "vpn.example.com:51820"},
				{Name: "allowed_ips", Label: "Allowed IPs", Type: TypeText, Required: false,
					Placeholder: "10.0.0.0/24"},
				{Name: "preshared_key", Label: "Preshared key", Type: TypePassword, Required: false},
			},
		},
		Template{
			Key: "tailscale", Name: "Tailscale", Category: "Network",
			Description: "Tailscale auth key (machine provisioning).",
			Fields: []Field{
				{Name: "auth_key", Label: "Auth key", Type: TypePassword, Required: true,
					Placeholder: "tskey-auth-...",
					Help: "ephemeral, reusable, pre-authorized — scope it to a tag"},
			},
		},
	)
}
