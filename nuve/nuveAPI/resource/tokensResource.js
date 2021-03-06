/*global exports, require, console, Buffer*/
var roomRegistry = require('./../mdb/roomRegistry');
var tokenRegistry = require('./../mdb/tokenRegistry');
var serviceRegistry = require('./../mdb/serviceRegistry');
var dataBase = require('./../mdb/dataBase');
var crypto = require('crypto');
var cloudHandler = require('../cloudHandler');
var logger = require('./../logger').logger;

// Logger
var log = logger.getLogger("TokensResource");

var currentService;
var currentRoom;

/*
 * Gets the service and the room for the proccess of the request.
 */
var doInit = function (roomId, callback) {
    "use strict";

    currentService = require('./../auth/nuveAuthenticator').service;

    serviceRegistry.getRoomForService(roomId, currentService, function (room) {
        //log.info(room);
        currentRoom = room;
        callback();
    });
};

var getTokenString = function (id, token) {
    "use strict";

    var toSign = id + ',' + token.host,
        hex = crypto.createHmac('sha1', dataBase.nuveKey).update(toSign).digest('hex'),
        signed = (new Buffer(hex)).toString('base64'),

        tokenJ = {
            tokenId: id,
            host: token.host,
            secure: token.secure,
            signature: signed
        },
        tokenS = (new Buffer(JSON.stringify(tokenJ))).toString('base64');

    return tokenS;
};

/*
 * Generates new token.
 * The format of a token is:
 * {tokenId: id, host: erizoController host, signature: signature of the token};
 */
var generateToken = function (callback) {
    "use strict";

    var user = require('./../auth/nuveAuthenticator').user,
        role = require('./../auth/nuveAuthenticator').role,
        r,
        tr,
        token,
        tokenS;

    if (user === undefined || user === '') {
        callback(undefined);
        return;
    }

    token = {};
    token.userName = user;
    token.room = currentRoom._id;
    token.role = role;
    token.service = currentService._id;
    token.creationDate = new Date();
    token.p2p = false;
    token.expireAt = new Date(new Date().getTime() + (24 * 60 * 60 * 1000)); // default is 24 hours
    token.use = 0; // now all token's have a use count since they expire.

    // Values to be filled from the erizoController
    token.secure = false;

    if (currentRoom.p2p) {
        token.p2p = true;
    }

    r = currentRoom._id;
    tr = undefined;

    if (currentService.testRoom !== undefined) {
        tr = currentService.testRoom._id;
    }

    if (tr === r) {

        if (currentService.testToken === undefined) {

            token.host = dataBase.testErizoController;

            log.info('Creating testToken');

            tokenRegistry.addToken(token, function (id) {

                token._id = id;
                currentService.testToken = token;
                serviceRegistry.updateService(currentService);

                tokenS = getTokenString(id, token);
                callback(tokenS);
                return;
            });

        } else {

            token = currentService.testToken;

            log.info('TestToken already exists, sending it', token);

            tokenS = getTokenString(token._id, token);
            callback(tokenS);
            return;

        }
    } else {

        cloudHandler.getErizoControllerForRoom (currentRoom, function (ec) {

            if (ec === 'timeout') {
                callback('error');
                return;
            }

            token.secure = ec.ssl;
            if (ec.hostname !== '') {
                token.host = ec.hostname;
            } else {
                token.host = ec.ip;
            }

            token.host += ':' + ec.port;

            tokenRegistry.addToken(token, function (id) {

                var tokenS = getTokenString(id, token);
                callback(tokenS);
            });
        });
    }
};

/*
 * Post Token. Creates a new token for a determined room of a service.
 */
exports.create = function (req, res) {
    "use strict";

    doInit(req.params.room, function () {

        if (currentService === undefined) {
            log.info('Service not found');
            res.send('Service not found', 404);
            return;
        } else if (currentRoom === undefined) {
            log.info('Room ', req.params.room, ' does not exist');
            res.send('Room does not exist', 404);
            return;
        }

        generateToken(function (tokenS) {

            if (tokenS === undefined) {
                res.send('Name and role?', 401);
                return;
            }
            if (tokenS === 'error') {
                res.send('CloudHandler does not respond', 401);
                return;
            }
            log.info('Created token for room ', currentRoom._id, 'and service ', currentService._id);
            res.send(tokenS);
        });
    });
};
