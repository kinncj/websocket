import {Readable} from 'stream';

/**
 * Represents the readable stream for binary frames
 * @class
 * @event readable
 * @event end
 */
export default class InStream extends Readable
{
    _read(){}

    addData(data)
    {
        this.push(data);
    }

    end()
    {
        this.push(null);
    }
}