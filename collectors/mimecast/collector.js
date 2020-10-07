/* -----------------------------------------------------------------------------
 * @copyright (C) 2020, Alert Logic, Inc
 * @doc
 *
 * mimecast class.
 *
 * @end
 * -----------------------------------------------------------------------------
 */
'use strict';

const moment = require('moment');
const PawsCollector = require('@alertlogic/paws-collector').PawsCollector;
const parse = require('@alertlogic/al-collector-js').Parse;
const calcNextCollectionInterval = require('@alertlogic/paws-collector').calcNextCollectionInterval;
const packageJson = require('./package.json');
const utils = require("./utils");


const typeIdPaths = [];

const tsPaths = [];

const Siem_Logs = 'SiemLogs';


class MimecastCollector extends PawsCollector {
    constructor(context, creds) {
        super(context, creds, packageJson.version);
    }

    pawsInitCollectionState(event, callback) {
        const startTs = process.env.paws_collection_start_ts ?
            process.env.paws_collection_start_ts :
            moment().toISOString();
        const endTs = moment(startTs).add(this.pollInterval, 'seconds').toISOString();

        const applicationNames = JSON.parse(process.env.paws_collector_param_string_1);
        const initialStates = applicationNames.map(applicationName => {
            if (applicationName === Siem_Logs) {
                return {
                    applicationName,
                    nextPage: null,
                    poll_interval_sec: 1
                }
            }
            else {
                return {
                    applicationName,
                    since: startTs,
                    until: endTs,
                    nextPage: null,
                    poll_interval_sec: 1
                }
            }
        });
        return callback(null, initialStates, 1);
    }

    pawsGetRegisterParameters(event, callback) {
        const regValues = {
            mimecastApplicationNames: process.env.paws_collector_param_string_1,
            mimecastApplicationID: process.env.paws_collector_param_string_2,
            mimecastApplicationKey: process.env.paws_collector_param_string_3
        };
        callback(null, regValues);
    }

    pawsGetLogs(state, callback) {
        let collector = this;

        const secretKey = collector.secret;
        if (!secretKey) {
            return callback("The secret key was not found!");
        }
        const accessKey = collector.clientId;
        if (!accessKey) {
            return callback("The access key was not found!");
        }

        const baseUrl = collector.pawsDomainEndpoint;
        if (!baseUrl) {
            return callback("The Endpoint was not found!");
        }

        const appId = process.env.paws_collector_param_string_2;
        if (!appId) {
            return callback("The app Id was not found!");
        }

        const appKey = process.env.paws_collector_param_string_3;
        if (!appKey) {
            return callback("The app key was not found!");
        }

        let authDetails = {
            "baseUrl": baseUrl,
            "accessKey": accessKey,
            "secretKey": secretKey,
            "appId": appId,
            "appKey": appKey
        };

        if (state.applicationName === Siem_Logs) {
            console.info(`MIME000001 Collecting data for ${state.applicationName}`);
        }
        else{
            console.info(`MIME000001 Collecting data for ${state.applicationName} from ${state.since} till ${state.until}`);
        }
        
        utils.getAPILogs(authDetails, state, [], process.env.paws_max_pages_per_invocation)
            .then(({ accumulator, nextPage }) => {
                let newState;
                if (nextPage === undefined) {
                    newState = this._getNextCollectionState(state);
                } else {
                    newState = this._getNextCollectionStateWithNextPage(state, nextPage);
                }
                console.info(`MIME000002 Next collection in ${newState.poll_interval_sec} seconds`);
                return callback(null, accumulator, newState, newState.poll_interval_sec);
            }).catch((error) => {
                return callback(error);
            });
    }

    _getNextCollectionState(curState) {
        if (curState.applicationName === Siem_Logs) {
            return {
                applicationName: curState.applicationName,
                nextPage: null,
                poll_interval_sec: 1
            }
        }
        else {
            
            const untilMoment = moment(curState.until);

            const { nextUntilMoment, nextSinceMoment, nextPollInterval } = calcNextCollectionInterval('no-cap', untilMoment, this.pollInterval);
            
            return {
                applicationName: curState.applicationName,
                since: nextSinceMoment.toISOString(),
                until: nextUntilMoment.toISOString(),
                nextPage: null,
                poll_interval_sec: nextPollInterval
            };
        }
    }

    _getNextCollectionStateWithNextPage(curState, nextPage) {
        if (curState.applicationName === Siem_Logs) {
            return {
                applicationName: curState.applicationName,
                nextPage: nextPage,
                poll_interval_sec: 1
            }
        }
        else {
            return {
                applicationName: curState.applicationName,
                since: curState.since,
                until: curState.until,
                nextPage: nextPage,
                poll_interval_sec: 1
            };
        }
    }

    pawsFormatLog(msg) {
        let collector = this;

        const ts = parse.getMsgTs(msg, tsPaths);
        const typeId = parse.getMsgTypeId(msg, typeIdPaths);

        let formattedMsg = {
            messageTs: ts.sec,
            priority: 11,
            progName: 'MimecastCollector',
            message: JSON.stringify(msg),
            messageType: 'json/mimecast',
            application_id: collector.application_id
        };

        if (typeId !== null && typeId !== undefined) {
            formattedMsg.messageTypeId = `${typeId}`;
        }
        if (ts.usec) {
            formattedMsg.messageTsUs = ts.usec;
        }
        return formattedMsg;
    }
}

module.exports = {
    MimecastCollector: MimecastCollector
}
