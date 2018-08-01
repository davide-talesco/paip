const stampit = require("@stamp/it");
const assert = require('assert');
const Errio = require("errio");
Errio.setDefaults({ stack: true });

const Logger = stampit({
  initializers: [
    function({ log }) {
      const LOG_LEVEL_MAP = {
        off: 60,
        error: 50,
        warn: 40,
        info: 30,
        debug: 20,
        trace: 10
      };

      log = process.env.PAIP_LOG || log;

      this._payload = {};

      if (log) {
        assert(
          Object.keys(LOG_LEVEL_MAP).includes(log),
          `log must be one of [ ${Object.keys(LOG_LEVEL_MAP)} ]`
        );
        this.options.logLevel = LOG_LEVEL_MAP[log];
      }
    }
  ],
  methods: {
    child() {
      // children logger should get parent options and parent _.payload
      const childLogger = Logger(this.options);
      childLogger.set(this._payload);
      return childLogger;
    },
    trace() {
      this._payload.level = 10;
      if (this.options.logLevel <= this._payload.level)
        console.log(JSON.stringify(this._payload));
    },
    debug() {
      this._payload.level = 20;
      if (this.options.logLevel <= this._payload.level)
        console.log(JSON.stringify(this._payload));
    },
    info() {
      this._payload.level = 30;
      if (this.options.logLevel <= this._payload.level)
        console.log(JSON.stringify(this._payload));
    },
    warn() {
      this._payload.level = 40;
      if (this.options.logLevel <= this._payload.level)
        console.log(JSON.stringify(this._payload));
    },
    error(err) {
      this._payload.level = 50;
      if (err) this._payload.error = Errio.stringify(err);
      if (this.options.logLevel <= this._payload.level)
        console.log(JSON.stringify(this._payload));
    },
    set(props) {
      if (typeof props !== "object") return this;
      // stamp this object with each property of props
      Object.keys(props).map(n => (this._payload[n] = props[n]));

      return this;
    }
  },
  props: {
    options: {
      // 10 === trace, 20 === debug, 30 === info , 40 === warn, 50 === error
      logLevel: 30
    }
  }
});

const logger = Logger({ log: 'debug'});

logger.set({ service: 'test'}).set({ name: 'davide'}).info();