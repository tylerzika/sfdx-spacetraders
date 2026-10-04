// Checks the running user's SpaceTraders agent token.
// The token is sent by the SpaceTraders_Agent named credential and never printed.
// Run: sf apex run -o space-traders -f scripts/apex/check-agent-token.apex
// Or in VS Code: SFDX: Execute Anonymous Apex with Editor Contents

ExternalService.SpaceTradersAgent svc = new ExternalService.SpaceTradersAgent();

try {
    ExternalService.SpaceTradersAgent.getMyAgent_Response res = svc.getMyAgent();
    ExternalService.SpaceTradersAgent_Agent agent = res.Code200.data;
    System.debug('AGENT OK: ' + agent.symbol
        + ' | faction ' + agent.startingFaction
        + ' | HQ ' + agent.headquarters
        + ' | credits ' + agent.credits
        + ' | ships ' + agent.shipCount);
} catch (ExternalService.SpaceTradersAgent.getMyAgent_ResponseException e) {
    // The spec documents only the 200 response, so error bodies arrive as a raw string.
    Map<String, Object> body = (Map<String, Object>) JSON.deserializeUntyped(e.defaultResponse);
    Map<String, Object> error = (Map<String, Object>) body.get('error');
    Integer code = Integer.valueOf(error.get('code'));
    String meaning;
    if (code == 4113 || code == 4109) {
        meaning = 'The server has reset. Register a new agent.';
    } else if (code == 4100 || code == 4103) {
        meaning = 'No usable agent token is stored. Register an agent.';
    } else if (code == 4105) {
        meaning = 'The agent credential holds an account token, not an agent token.';
    } else {
        meaning = 'Unexpected error.';
    }
    System.debug('AGENT NOT OK: HTTP ' + e.responseCode + ' | code ' + code
        + ' | ' + meaning + ' | ' + error.get('message'));
}
