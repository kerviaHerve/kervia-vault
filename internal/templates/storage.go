// Template registry — Storage (object storage: S3 & compatibles).
// Le générique S3 couvre AWS, MinIO, Wasabi, Scaleway Object Storage…
// via endpoint ; Backblaze B2 a son format propre.
//
// SPDX-License-Identifier: AGPL-3.0

package templates

func init() {
	register(
		Template{
			Key: "s3", Name: "S3 / compatible (generic)", Category: "Storage",
			Description: "Any S3-compatible object storage (AWS, MinIO, Wasabi, Scaleway…).",
			Fields: []Field{
				{Name: "endpoint", Label: "Endpoint URL", Type: TypeURL, Required: false,
					Help: "leave empty for AWS S3", Placeholder: "https://s3.example.com"},
				{Name: "region", Label: "Region", Type: TypeText, Required: true,
					Placeholder: "eu-west-3 / fr-par"},
				{Name: "access_key_id", Label: "Access key ID", Type: TypeText, Required: true},
				{Name: "secret_access_key", Label: "Secret access key", Type: TypePassword, Required: true},
				{Name: "bucket", Label: "Bucket", Type: TypeText, Required: false},
			},
		},
		Template{
			Key: "backblaze-b2", Name: "Backblaze B2", Category: "Storage",
			Description: "Backblaze B2 application key.",
			Fields: []Field{
				{Name: "key_id", Label: "keyID", Type: TypeText, Required: true},
				{Name: "application_key", Label: "applicationKey", Type: TypePassword, Required: true},
				{Name: "bucket", Label: "Bucket", Type: TypeText, Required: false},
			},
		},
	)
}
