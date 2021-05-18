const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const moment = require('moment');
var request = require('request');

const Siem_Logs = 'SiemLogs';
const Attachment_Protect_Logs = 'AttachmentProtectLogs';
const URL_Protect_Logs = 'URLProtectLogs';
const Malware_Feed = 'MalwareFeed';


function getAPILogs(authDetails, state, accumulator, maxPagesPerInvocation) {
    let pageCount = 0;
    let nextPage = state.nextPage ? state.nextPage : undefined;

    return new Promise(function (resolve, reject) {
        getData();
        function getData() {
            if (pageCount < maxPagesPerInvocation) {

                let applicationDetails = getAPIDetails(state, nextPage);
                if (!applicationDetails.uri) {
                    reject("The application name was not found!");
                }

                let requestHeaders = generateHeaders(authDetails, applicationDetails.uri);

                request.post({
                    url: `https://${authDetails.baseUrl}${applicationDetails.uri}`,
                    headers: requestHeaders,
                    body: JSON.stringify(applicationDetails.payload)
                }, function (error, response, body) {
                    if (error) {
                        return reject(error);
                    }
                    body = JSON.parse(body);
                    if (body.fail && body.fail[0] && body.fail[0].errors) {
                        return reject(body.fail[0].errors[0]);
                    }
                    pageCount++;
                    switch (state.stream) {
                        case Siem_Logs:
                            if (response.meta && response.meta.isLastToken) {
                                nextPage = undefined;
                                return resolve({ accumulator, nextPage });
                            }
                            if (response.headers && response.headers['mc-siem-token']) {
                                nextPage = response.headers['mc-siem-token'];
                            }
                            if (body.data) {
                                accumulator.push(...body.data);
                            }
                            break;
                        case Malware_Feed:
                            if (body.objects.length === 0) {
                                nextPage = undefined;
                                return resolve({ accumulator, nextPage });
                            }
                            if (body.id) {
                                nextPage = body.id;
                            }
                            accumulator.push(...body.objects);
                            break;
                        case Attachment_Protect_Logs:
                        case URL_Protect_Logs:
                            if (state.stream === Attachment_Protect_Logs && body.data && body.data[0] && body.data[0].attachmentLogs) {
                                accumulator.push(...body.data[0].attachmentLogs);
                            }
                            if (state.stream === URL_Protect_Logs && body.data && body.data[0] && body.data[0].clickLogs) {
                                accumulator.push(...body.data[0].clickLogs);
                            }
                            if (body.meta.pagination.next) {
                                nextPage = body.meta.pagination.next;
                            } else {
                                nextPage = undefined;
                                return resolve({ accumulator, nextPage });
                            }
                            break;
                    }
                    getData();
                });
            }
            else {
                return resolve({ accumulator, nextPage });
            }
        }
    });
}

function getAPIDetails(state, nextPage) {
    let uri = "";
    let payload = "";
    switch (state.stream) {
        case Siem_Logs:
            uri = `/api/audit/get-siem-logs`;
            if (nextPage === undefined) {
                payload = {
                    "data": [
                        {
                            'type': 'MTA',
                            'fileFormat': 'JSON'
                        }
                    ]
                };
            }
            else {
                payload = {
                    "data": [
                        {
                            'type': 'MTA',
                            'token': nextPage,
                            'fileFormat': 'JSON'
                        }
                    ]
                };

            }
            break;
        case Attachment_Protect_Logs:
        case URL_Protect_Logs:

            if (state.stream === Attachment_Protect_Logs) {
                uri = `/api/ttp/attachment/get-logs`;
            }

            if (state.stream === URL_Protect_Logs) {
                uri = `/api/ttp/url/get-logs`;
            }

            if (nextPage === undefined) {
                payload = {
                    "meta": {
                        "pagination": {
                            "pageSize": 100
                        }
                    },
                    "data": [
                        {
                            "oldestFirst": true,
                            "from": state.since,
                            "route": "all",
                            "to": state.until
                            // "result": "all"
                        }
                    ]
                };
            }
            else {
                payload = {
                    "meta": {
                        "pagination": {
                            "pageSize": 100,
                            "pageToken": nextPage
                        }
                    },
                    "data": [
                        {
                            "oldestFirst": true,
                            "from": state.since,
                            "route": "all",
                            "to": state.until
                            // "result": "all"
                        }
                    ]
                };
            }
            break;
        case Malware_Feed:
            uri = `/api/ttp/threat-intel/get-feed`;
            if (nextPage === undefined) {
                payload = {
                    "data": [
                        {
                            "end": state.until,
                            "fileType": "stix",
                            "start": state.since,
                            "feedType": "malware_customer"
                        }
                    ]
                };
            }
            else {
                payload = {
                    "data": [
                        {
                            "end": state.until,
                            "fileType": "stix",
                            "start": state.since,
                            "token": nextPage,
                            "feedType": "malware_customer"
                        }
                    ]
                };
            }
            break;
        default:
            uri = null;
    }

    return {
        uri,
        payload
    };
}

function generateHeaders(authDetails, uri) {
    let requestId = uuidv4().toString();
    let hdrDate = moment().utc().format('ddd, DD MMM YYYY HH:mm:ss z');

    let hmac = crypto.createHmac("sha1", Buffer.from(authDetails.secretKey, 'base64'));
    hmac.write(`${hdrDate}:${requestId}:${uri}:${authDetails.appKey}`);
    hmac.end();       // can't read from the stream until you call end()
    signature = hmac.read().toString('base64'); 

    return {
        "Authorization": `MC ${authDetails.accessKey}:${signature}`,
        "x-mc-app-id": authDetails.appId,
        "x-mc-date": hdrDate,
        "x-mc-req-id": requestId,
        "Content-Type": 'application/json'
    };
}

module.exports = {
    getAPILogs: getAPILogs
};