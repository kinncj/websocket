var LEVELS = {
    "none": 0,
    "debug": 1,
    "info": 2,
    "warn": 3,
    "error": 4,
    "critical": 5
};

export default class Logger
{
    constructor(name)
    {
        this.name = name || 'Global';
    }

    _log(levelName, consoleMethod, ...message)
    {
        let level      = LEVELS[levelName];
        var configLevel = LEVELS[global.LOG_LEVEL];

        if (configLevel === undefined) {
            console.error("'global.LOG_LEVEL' isn't configured");
        }

        if (!level) {
            throw new Error(`Log level "${levelName}" doesn't exist`);
        }

        if (configLevel === LEVELS.none) {
            return;
        }

        if (level >= configLevel) {
            console[consoleMethod](message);
        }
    }

    log(...message)
    {
        this._log('debug', 'log', message);
    }

    debug(...message)
    {
        this._log('debug', 'trace', message);
    }

    info(...message)
    {
        this._log('info', 'info', message);
    }

    warn(...message)
    {
        this._log('warn', 'warn', message);
    }

    error(...message)
    {
        this._log('error', 'error', message);
    }

    critical(...message)
    {
        this._log('critical', 'error', message);
    }
}