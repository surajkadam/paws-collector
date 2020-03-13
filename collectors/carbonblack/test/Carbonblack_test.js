const assert = require('assert');
const sinon = require('sinon');
var AWS = require('aws-sdk-mock');
const m_response = require('cfn-response');
const carbonblackMock = require('./carbonblack_mock');
var CarbonblackCollector = require('../collector').CarbonblackCollector;
const moment = require('moment');
const utils = require("../utils");


var responseStub = {};
let getAPIDetails;
let getAPILogs;

function setAlServiceStub() {
    getAPILogs = sinon.stub(utils, 'getAPILogs').callsFake(
        function fakeFn(apiDetails, accumulator, state, clientSecret, clientId, maxPagesPerInvocation) {
            return new Promise(function (resolve, reject) {
                return resolve({ accumulator: [carbonblackMock.LOG_EVENT, carbonblackMock.LOG_EVENT]});
            });
        });

    getAPIDetails = sinon.stub(utils, 'getAPIDetails').callsFake(
        function fakeFn(state, apiEndpoint, orgKey) {
            return {
                url: "url",
                method: "GET",
                requestBody: "sortFieldName",
                typeIdPaths: [{ path: ["eventId"] }],
                tsPaths: [{ path: ["eventTime"] }]
            };
        });

}

function restoreAlServiceStub() {
    getAPILogs.restore();
    getAPIDetails.restore();
}

describe('Unit Tests', function () {

    beforeEach(function () {
        AWS.mock('SSM', 'getParameter', function (params, callback) {
            const data = new Buffer('test-secret');
            return callback(null, { Parameter: { Value: data.toString('base64') } });
        });
        AWS.mock('KMS', 'decrypt', function (params, callback) {
            const data = {
                Plaintext: '{}'
            };
            return callback(null, data);
        });

        responseStub = sinon.stub(m_response, 'send').callsFake(
            function fakeFn(event, mockContext, responseStatus, responseData, physicalResourceId) {
                mockContext.succeed();
            });
        setAlServiceStub();
    });

    afterEach(function () {
        restoreAlServiceStub();
        responseStub.restore();
    });

    describe('Paws Init Collection State', function () {
        let ctx = {
            invokedFunctionArn: carbonblackMock.FUNCTION_ARN,
            fail: function (error) {
                assert.fail(error);
            },
            succeed: function () { }
        };
        it('get inital state less than 7 days in the past', function (done) {
            CarbonblackCollector.load().then(function (creds) {
                var collector = new CarbonblackCollector(ctx, creds, 'carbonblack');
                const startDate = moment().subtract(1, 'days').toISOString();
                process.env.paws_collection_start_ts = startDate;

                collector.pawsInitCollectionState(null, (err, initialStates, nextPoll) => {
                    initialStates.forEach((state) => {
                        assert.equal(state.since, startDate, "Dates are not equal");
                        assert.notEqual(moment(state.until).diff(state.since, 'hours'), 24);
                    });
                    done();
                });
            });
        });
        it('get inital state less than 24 hours in the past', function (done) {
            CarbonblackCollector.load().then(function (creds) {
                var collector = new CarbonblackCollector(ctx, creds, 'carbonblack');
                const startDate = moment().subtract(12, 'hours').toISOString();
                process.env.paws_collection_start_ts = startDate;

                collector.pawsInitCollectionState(null, (err, initialStates, nextPoll) => {
                    initialStates.forEach((state) => {
                        assert.notEqual(moment(state.until).diff(state.since, 'hours'), 24);
                    });
                    done();
                });
            });
        });

    });

    describe('Paws Get Register Parameters', function () {
        it('Paws Get Register Parameters Success', function (done) {
            let ctx = {
                invokedFunctionArn: carbonblackMock.FUNCTION_ARN,
                fail: function (error) {
                    assert.fail(error);
                    done();
                },
                succeed: function () {
                    done();
                }
            };

            CarbonblackCollector.load().then(function (creds) {
                var collector = new CarbonblackCollector(ctx, creds, 'carbonblack');
                const sampleEvent = { ResourceProperties: { StackName: 'a-stack-name' } };
                collector.pawsGetRegisterParameters(sampleEvent, (err, regValues) => {
                    const expectedRegValues = {
                        carbonblackAPINames: '["AuditLogEvents", "SearchAlerts","SearchAlertsCBAnalytics", "SearchAlertsVmware", "SearchAlertsWatchlist"]',
                        carbonblackOrgKey: 'carbonblackOrgKey'
                    };
                    assert.deepEqual(regValues, expectedRegValues);
                    done();
                });
            });
        });
    });

    describe('pawsGetLogs', function () {
        let ctx = {
            invokedFunctionArn: carbonblackMock.FUNCTION_ARN,
            fail: function (error) {
                assert.fail(error);
            },
            succeed: function () { }
        };
        it('Paws Get Logs Success', function (done) {
            CarbonblackCollector.load().then(function (creds) {
                var collector = new CarbonblackCollector(ctx, creds, 'carbonblack');
                const startDate = moment().subtract(3, 'days');
                const curState = {
                    apiName: "AuditLogEvents",
                    since: startDate.toISOString(),
                    until: startDate.add(2, 'days').toISOString(),
                    nextPage: null,
                    poll_interval_sec: 1
                };

                collector.pawsGetLogs(curState, (err, logs, newState, newPollInterval) => {
                    assert.equal(logs.length, 2);
                    assert.equal(newState.poll_interval_sec, 1);
                    assert.ok(logs[0].eventId);
                    done();
                });

            });
        });
    });

    describe('Next state tests', function () {
        let ctx = {
            invokedFunctionArn: carbonblackMock.FUNCTION_ARN,
            fail: function (error) {
                assert.fail(error);
            },
            succeed: function () { }
        };
        it('get next state if more than 24 hours in the past', function (done) {
            const startDate = moment().subtract(10, 'days');
            const curState = {
                since: startDate.toISOString(),
                until: startDate.add(5, 'days').toISOString(),
                poll_interval_sec: 1
            };
            CarbonblackCollector.load().then(function (creds) {
                var collector = new CarbonblackCollector(ctx, creds, 'carbonblack');
                const newState = collector._getNextCollectionState(curState);
                assert.equal(moment(newState.until).diff(newState.since, 'hours'), 24);
                assert.equal(newState.poll_interval_sec, 1);
                done();
            });
        });


        it('get next state if more than 1 hours in the past', function (done) {
            const startDate = moment().subtract(5, 'hours');
            const curState = {
                since: startDate.toISOString(),
                until: startDate.add(3, 'hours').toISOString(),
                poll_interval_sec: 1
            };
            CarbonblackCollector.load().then(function (creds) {
                var collector = new CarbonblackCollector(ctx, creds, 'carbonblack');
                const newState = collector._getNextCollectionState(curState);
                assert.equal(moment(newState.until).diff(newState.since, 'hours'), 1);
                assert.equal(newState.poll_interval_sec, 1);
                done();
            });
        });


        it('get next state if less than 1 hour in the past but more than the polling interval', function (done) {
            const startDate = moment().subtract(20, 'minutes');
            CarbonblackCollector.load().then(function (creds) {
                var collector = new CarbonblackCollector(ctx, creds, 'carbonblack');
                const curState = {
                    since: startDate.toISOString(),
                    until: startDate.add(collector.pollInterval, 'seconds').toISOString(),
                    poll_interval_sec: 1
                };
                const newState = collector._getNextCollectionState(curState);
                assert.equal(moment(newState.until).diff(newState.since, 'seconds'), collector.pollInterval);
                assert.equal(newState.poll_interval_sec, 1);
                done();
            });
        });

        it('get next state if within polling interval', function (done) {
            CarbonblackCollector.load().then(function (creds) {
                var collector = new CarbonblackCollector(ctx, creds, 'carbonblack');
                const startDate = moment().subtract(collector.pollInterval * 2, 'seconds');
                const curState = {
                    since: startDate.toISOString(),
                    until: startDate.add(collector.pollInterval, 'seconds').toISOString(),
                    poll_interval_sec: 1
                };
                const newState = collector._getNextCollectionState(curState);
                assert.equal(moment(newState.until).diff(newState.since, 'seconds'), collector.pollInterval);
                assert.equal(newState.poll_interval_sec, collector.pollInterval);
                done();
            });
        });
    });

    describe('Format Tests', function () {
        it('log format success', function (done) {
            let ctx = {
                invokedFunctionArn: carbonblackMock.FUNCTION_ARN,
                fail: function (error) {
                    assert.fail(error);
                    done();
                },
                succeed: function () {
                    done();
                }
            };

            CarbonblackCollector.load().then(function (creds) {
                var collector = new CarbonblackCollector(ctx, creds, 'carbonblack');
                let fmt = collector.pawsFormatLog(carbonblackMock.LOG_EVENT);
                assert.equal(fmt.progName, 'CarbonblackCollector');
                assert.ok(fmt.messageType);
                done();
            });
        });
    });

    describe('NextCollectionStateWithNextPage', function () {
        it('Get Next Collection State With NextPage Success', function (done) {
            let ctx = {
                invokedFunctionArn: carbonblackMock.FUNCTION_ARN,
                fail: function (error) {
                    assert.fail(error);
                    done();
                },
                succeed: function () {
                    done();
                }
            };

            const startDate = moment().subtract(5, 'minutes');
            const curState = {
                apiName: "SearchAlerts",
                since: startDate.toISOString(),
                until: startDate.add(5, 'minutes').toISOString(),
                poll_interval_sec: 1
            };
            const nextPage = "offset";
            CarbonblackCollector.load().then(function (creds) {
                var collector = new CarbonblackCollector(ctx, creds, 'carbonblack');
                let nextState = collector._getNextCollectionStateWithNextPage(curState, nextPage);
                assert.ok(nextState.since);
                assert.equal(nextState.since, curState.since);
                done();
            });
        });
    });
});
