/**
 * Stores SpaceTraders tokens in the running user's per-user credential.
 *
 * Each External Credential (SpaceTraders_Account, SpaceTraders_Agent) uses the
 * Basic protocol with one per-user principal named Players. The token is kept
 * as the encrypted "password" key. The custom header on each External
 * Credential sends it as: {!'Bearer ' & $Credential.Password}
 *
 * See docs/token-storage-design.md.
 */
public with sharing class SpaceTradersCredentials {

    public static final String ACCOUNT_CREDENTIAL = 'SpaceTraders_Account';
    public static final String AGENT_CREDENTIAL = 'SpaceTraders_Agent';
    public static final String PRINCIPAL = 'Players';

    public class CredentialException extends Exception {}

    public class AgentTokenRequest {
        @InvocableVariable(label='Agent Token' description='The data.token value returned by POST /register.' required=true)
        public String token;

        @InvocableVariable(label='Callsign' description='The agent symbol. Stored as the credential username for reference only.')
        public String callsign;
    }

    @InvocableMethod(
        label='Save Agent Token'
        description='Stores a SpaceTraders agent token in the running user\'s per-user SpaceTraders_Agent credential.'
        category='SpaceTraders'
    )
    public static void saveAgentToken(List<AgentTokenRequest> requests) {
        for (AgentTokenRequest request : requests) {
            saveToken(AGENT_CREDENTIAL, request.callsign, request.token);
        }
    }

    /**
     * Creates or replaces the running user's credential on the given External
     * Credential. The token is stored encrypted and never logged.
     */
    public static void saveToken(String externalCredential, String username, String token) {
        if (String.isBlank(token)) {
            throw new CredentialException('A token is required.');
        }

        ConnectApi.CredentialInput input = new ConnectApi.CredentialInput();
        input.externalCredential = externalCredential;
        input.principalName = PRINCIPAL;
        input.principalType = ConnectApi.CredentialPrincipalType.PerUserPrincipal;
        input.authenticationProtocol = ConnectApi.CredentialAuthenticationProtocol.Basic;
        input.credentials = new Map<String, ConnectApi.CredentialValueInput>{
            'username' => credentialValue(String.isBlank(username) ? 'player' : username, false),
            'password' => credentialValue(token, true)
        };

        if (hasStoredCredential(externalCredential)) {
            ConnectApi.NamedCredentials.updateCredential(input);
        } else {
            ConnectApi.NamedCredentials.createCredential(input);
        }
    }

    /**
     * True when the running user already has values stored on the given
     * External Credential. Only key names are checked. Encrypted values are
     * never returned by getCredential.
     */
    public static Boolean hasStoredCredential(String externalCredential) {
        try {
            ConnectApi.Credential existing = ConnectApi.NamedCredentials.getCredential(
                externalCredential, PRINCIPAL, ConnectApi.CredentialPrincipalType.PerUserPrincipal
            );
            return existing.credentials != null && existing.credentials.containsKey('password');
        } catch (Exception e) {
            return false;
        }
    }

    private static ConnectApi.CredentialValueInput credentialValue(String value, Boolean encrypted) {
        ConnectApi.CredentialValueInput input = new ConnectApi.CredentialValueInput();
        input.value = value;
        input.encrypted = encrypted;
        return input;
    }
}