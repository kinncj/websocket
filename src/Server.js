import net            from 'net';
import tls            from 'tls';
import {EventEmitter} from 'events';
import Connection     from './Connection';
import Logger         from './Logger.js';

const CONNECTION_TYPES = [net, tls];

export default class Server extends EventEmitter
{
    constructor(secure, options, callback)
    {
        super();

        this.logger = new Logger("Server");

        if (typeof(options) === typeof(Function)) {
            callback = options;
            options  = undefined;
        }
        this.connectionList = [];
        this.socket         = CONNECTION_TYPES[secure | 0].createServer(options, this.onConnection.bind(this));

        this.logger.info('Connection type:', (secure | 0) ? 'net' : 'tls');
        this.registerListeners(callback);
    }

    onConnection(socket)
    {
        let connection = new Connection(socket, this, function () {
            this.logger.info('New Connection:', connection.headers.host);
            this.connectionList.push(connection);
            connection.removeListener('error', function(){});
            this.emit('connection', connection)
        }.bind(this));

        connection.on('close', function () {
            let index = this.connectionList.indexOf(connection);

            if (index !== -1) {
                this.connectionList.splice(index, 1);
            }
        }.bind(this));

        connection.on('error', function(){})
    }

    registerListeners(callback)
    {
        this.socket.on('close', function () {
            this.emit('close')
        }.bind(this));

        this.socket.on('error', function (err) {
            this.emit('error', err)
        }.bind(this));

        this.socket.on('connection', function(data){
            this.logger.debug('ops', data);
        }.bind(this));

        if (callback) {
            this.on('connection', callback);
        }
    }

    listen(port, host, callback)
    {
        if (typeof(host) === typeof(Function)) {
            callback = host;
            host     = undefined;
        }

        if (callback) {
            this.on('listening', callback)
        }

        this.socket.listen(port, host, function () {
            this.emit('listening');
        }.bind(this));

        return this;
    }
}