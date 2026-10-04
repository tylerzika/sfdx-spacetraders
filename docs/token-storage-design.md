# Per-User API Tokens with Named Credentials

A pattern for calling an external API where every Salesforce user has their own
bearer token. Built and tested in the `space-traders` scratch org, 2026-10-03 to
2026-10-04, using the SpaceTraders API as the example.

## Problem

The external API authenticates with `Authorization: Bearer <token>`. Each user
has their own token. Thousands of users must each send only their own token,
and no token may be stored in source, records or custom settings.

## Pattern

Use an External Credential with the **Basic** protocol and one **per-user
principal**. Each user's token is stored as their per-user "password." A custom
header turns it into a Bearer header.

| Piece | Setting |
| --- | --- |
| External Credential | Protocol: Basic |
| Principal | Identity type: Per User Principal. One principal for all users |
| Custom header on the External Credential | `Authorization` = `{!'Bearer ' & $Credential.Password}` |
| Named Credential | API base URL. Generate Authorization Header off. Allow Formulas in HTTP Header on |
| Permission set | External Credential Principal Access to the principal. Read on User External Credentials |

One principal and one permission set serve every user. A second token type gets
a second External Credential and Named Credential built the same way.

SpaceTraders example:

| Named Credential | External Credential | Token | Used for |
| --- | --- | --- | --- |
| `SpaceTraders_Account` | `SpaceTraders_Account`, Basic, per user | Account token | `POST /register` |
| `SpaceTraders_Agent` | `SpaceTraders_Agent`, Basic, per user | Agent token | All game calls |
| `SpaceTraders_Public` | `SpaceTraders_Public`, No Authentication | None | Public endpoints |

## Where each user's token lives

Per-user values are stored encrypted in the User External Credential object.
"Tokens for named credential callouts are encrypted and stored in the User
External Credential object." ([Enable User External Credentials][uec])

A Basic per-user credential holds two keys for each user.

| Key | Holds | Encrypted |
| --- | --- | --- |
| `username` | A label. The API ignores it. | No |
| `password` | The token | Yes |

Values are written in one of two ways:

- **By the user,** on the External Credentials page in their personal settings.
  The Basic per-user principal is documented as each user authenticating "from
  the External Credentials page in their personal settings."
  ([Authentication Status for External Credentials][status])
- **By Apex,** with `ConnectApi.NamedCredentials.createCredential` the first time
  and `updateCredential` after that, using principal type `PerUserPrincipal`.
  ([NamedCredentials Class][ncapex])

`getCredential` returns the key names but never the encrypted value, even for
the user's own credential. ([ConnectApi.Credential][credout])

## How a callout picks the right token

1. Code calls `callout:SpaceTraders_Agent/my/agent`.
2. The Named Credential references one External Credential.
3. The running user's permission set grants that External Credential's principal.
   "At run time, Salesforce ensures that the user has the permission set before
   accessing the remote system." ([Enable External Credential Principals][enable])
4. The principal is per user, so Salesforce loads that user's own values.
5. The header formula runs, and `$Credential.Password` becomes that user's token.

`$Credential` with no External Credential name means the current callout's
credential for the running user. The Apex merge field reference describes
`{!$Credential.Password}` as the "username and password of the running user."
([Merge Fields for Apex Callouts][merge]) That's why one formula serves every
user, and why the same formula on two External Credentials reads two different
tokens.

## What deploys

| In source | Not in source |
| --- | --- |
| External Credential, principal, custom header | Each user's username and password |
| Named Credential | |
| Permission set with principal access, `ExternalCredential-Principal` | |

Metadata API "can't fully expose the definition of a credential and render
sensitive information like tokens in plain text." Tokens are populated "in the
UI or via the Connect API." ([Packageable Components][pkg]) The permission set
names a principal as the External Credential and principal "separated by a
dash." ([PermissionSet metadata][permset])

## What we learned

**Only `$Credential.Password` works under Basic.** Tested header values:

| Header value | Result |
| --- | --- |
| `$Credential.SpaceTraders_Account.Password` | "Field does not exist" |
| `$Credential.SpaceTraders_Account.password` | "Field does not exist" |
| `$Credential.Password` | Works |

The named form, `$Credential.<External Credential>.<parameter>`, is for
authentication parameters you define under the Custom protocol.
([Use API Keys in Custom Headers][apikeys])

**Per-user needs Basic, not Custom.** "The Custom authentication protocol
supports only the Named Principal identity type." ([Authentication Status][status])
With Custom, each user would need their own principal and permission set. One
doc page still says "only the OAuth protocol supports unique per-user access."
([Use API Keys in Custom Headers][apikeys]) Testing shows Basic per-user works.

**Saving a credential blocks later callouts in that transaction.** Apex fails
with "You have uncommitted work pending." Make the callout first, then save the
token. Any call that needs the new token runs in a later transaction.

**Names must match exactly.** A formula that names the wrong External Credential
fails at callout time. A misspelled `Authorization` header name saves without
error, but the API never receives the token.

**Use the API's own errors to test without side effects.** Calling an endpoint
that expects a different token type shows which token arrived. SpaceTraders
returned code 4105, "Expected agent-token but received account-token," which
proved the account token was sent.

## Why not the alternatives

| Option | Problem | Source |
| --- | --- | --- |
| Custom settings | Outside a managed package, readable "for all profiles, including the guest user." The docs say "Do not store secrets" there. | [Custom Settings][cs] |
| Custom protocol, one named principal per user | One principal and permission set per user. Doesn't scale. | [Authentication Status][status] |
| Remote Site Setting | Allows the URL but stores no credentials. Named credentials let you "skip remote site settings." | [Named Credentials as Callout Endpoints][ncendpoint] |

## Exam objectives

From the Platform Integration Architect exam outline:

- **Build Solution:** "Given a use case, create a security solution for inbound
  or outbound integrations."
- **Build Solution:** "Given a use case, identify the considerations when
  choosing the right option in making an outbound call to an external system."
- **Translate Needs to Integration Requirements:** "Given a use case, identify
  integration security / authentication / authorization requirements."
- **Design Integration Solutions:** "Given a use case, identify the trade-offs,
  limitations, and constraints that meet the proposed solution."

From the Identity and Access Management Architect exam outline:

- **Identity Management Concepts:** "Describe how trust is established between
  two systems."

## References

- [Create or Edit a Basic Authentication External Credential][basic]
- [Understand the Authentication Status for External Credentials][status]
- [Enable User External Credentials][uec]
- [Enable External Credential Principals][enable]
- [Named Credentials Glossary][glossary]
- [Use API Keys in Custom Headers with Named Credentials][apikeys]
- [Merge Fields for Apex Callouts That Use Named Credentials][merge]
- [Named Credentials as Callout Endpoints][ncendpoint]
- [ConnectApi NamedCredentials Class][ncapex]
- [ConnectApi.Credential][credout]
- [PermissionSet Metadata][permset]
- [Components Available in Second-Generation Managed Packages][pkg]
- [Custom Settings][cs]

[basic]: https://help.salesforce.com/s/articleView?id=xcloud.nc_create_edit_basic_auth_ext_cred.htm&type=5
[status]: https://help.salesforce.com/s/articleView?id=xcloud.nc_understand_configuration_status.htm&type=5
[uec]: https://help.salesforce.com/s/articleView?id=xcloud.nc_user_external_credentials.htm&type=5
[enable]: https://help.salesforce.com/s/articleView?id=xcloud.nc_enable_ext_cred_principal.htm&type=5
[glossary]: https://help.salesforce.com/s/articleView?id=xcloud.nc_named_credentials_glossary.htm&type=5
[apikeys]: https://help.salesforce.com/s/articleView?id=xcloud.nc_custom_headers_and_api_keys.htm&type=5
[merge]: https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_callouts_named_credentials_merge_fields.htm
[ncendpoint]: https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_callouts_named_credentials.htm
[ncapex]: https://developer.salesforce.com/docs/atlas.en-us.apexref.meta/apexref/apex_ConnectAPI_NamedCredentials_static_methods.htm
[credout]: https://developer.salesforce.com/docs/atlas.en-us.apexref.meta/apexref/apex_connectapi_output_credential.htm
[permset]: https://developer.salesforce.com/docs/atlas.en-us.api_meta.meta/api_meta/meta_permissionset.htm
[pkg]: https://developer.salesforce.com/docs/platform/pkg2-dev/guide/packaging-packageable-components.html
[cs]: https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_customsettings.htm
