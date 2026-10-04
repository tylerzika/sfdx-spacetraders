// Checks the running user's SpaceTraders agent token.
// The token is sent by the SpaceTraders_Agent named credential and never printed.
// Run: sf apex run -o space-traders -f scripts/apex/check-agent-token.apex
// Or in VS Code: SFDX: Execute Anonymous Apex with Editor Contents

HttpRequest req = new HttpRequest();
req.setEndpoint('callout:SpaceTraders_Agent/my/agent');
req.setMethod('GET');
HttpResponse res = new Http().send(req);

Map<String, Object> body = (Map<String, Object>) JSON.deserializeUntyped(res.getBody());

if (res.getStatusCode() == 200) {
    Map<String, Object> agent = (Map<String, Object>) body.get('data');
    System.debug('AGENT OK: ' + agent.get('symbol')
        + ' | faction ' + agent.get('startingFaction')
        + ' | HQ ' + agent.get('headquarters')
        + ' | credits ' + agent.get('credits')
        + ' | ships ' + agent.get('shipCount'));
} else {
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
    System.debug('AGENT NOT OK: HTTP ' + res.getStatusCode() + ' | code ' + code
        + ' | ' + meaning + ' | ' + error.get('message'));
}
