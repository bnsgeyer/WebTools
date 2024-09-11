//const math = require('math.js');
//const { fft, ifft, fftshift } = require('fft-js');

class CZT {
    constructor(n, m = null, w = 1, a = 1) {
        if (m === null) {
            m = n;
        }
        if (w === null) {
            w = math.Complex(Math.cos(-1*Math.PI/m),math.sin(-1*Math.PI/m));
           // w = math.exp(-1*j * Math.PI / m);
        } else if (typeof w === 'number') {
            w = math.Complex(Math.cos(-2*Math.PI/m*w),math.sin(-2*Math.PI/m*w));
          //  w = math.exp(-2*j * Math.PI / m * w);
        }
        this.w = w;
        this.a = a;
        this.m = m;
        this.n = n;

        const k = math.range(0, Math.max(m, n)).toArray();
        const wk2 = k.map(val => math.pow(w, val ** 2 / 2));
        const nfft = 2 ** nextPow2(n + m - 1);
        this._Awk2 = math.multiply(math.pow(a, -k), wk2).slice(0, n);
        this._nfft = nfft;
        this._Fwk2 = math.fft(math.concat([wk2.slice(n - 1, 0, -1), wk2.slice(0, m)]), nfft);
        this._wk2 = wk2.slice(0, m);
        this._yidx = { start: n - 1, end: n + m - 1 };
    }

    transform(x, axis = -1) {
        const xArray = math.clone(x);
        if (xArray.length !== this.n) {
            throw new Error(`CZT defined for length ${this.n}, not ${xArray.length}`);
        }
        const trnsp = Array.from(Array(xArray.length).keys()).reverse();
        xArray.reverse();
        let y = ifft(math.multiply(this._Fwk2, fft(math.multiply(xArray, this._Awk2), this._nfft)));
        y = y.slice(this._yidx.start, this._yidx.end).map((val, idx) => val * this._wk2[idx]);
        return y.reverse();
    }
}

function nextPow2(n) {
    return Math.ceil(Math.log2(n));
}

class ZoomFFT extends CZT {
    constructor(n, f1, f2 = null, m = null, Fs = 2) {
        if (m === null) m = n;
        if (f2 === null) [f1, f2] = [0, f1];
        const w = math.Complex(Math.cos(-2 * Math.PI * (f2 - f1) / ((m - 1) * Fs)),math.sin(-2 * Math.PI * (f2 - f1) / ((m - 1) * Fs)));
        //const w = math.exp(-2*j * Math.PI * (f2 - f1) / ((m - 1) * Fs));
        const a = math.Complex(Math.cos(2 * Math.PI * f1 / Fs),math.sin(2 * Math.PI * f1 / Fs));
        //const a = math.exp(2*j * Math.PI * f1 / Fs);
        super(n, m, w, a);
        this.f1 = f1;
        this.f2 = f2;
        this.Fs = Fs;
    }
}

class ScaledFFT extends CZT {
    constructor(n, m = null, scale = 1.0) {
        if (m === null) {
            m = n;
        }
        const w = math.Complex(Math.cos(-2 * Math.PI / m * scale),math.sin(-2 * Math.PI / m * scale));
      //  const w = math.exp(-2*j * Math.PI / m * scale);
        const a = math.pow(w, Math.floor((m + 1) / 2));
        super(n, m, w, a);
        this.scale = scale;
    }

    transform(x, axis = -1) {
        return fftshift(super.transform(x, axis));
    }
}

function scaledfft(x, m = null, scale = 1.0, axis = -1) {
    const transform = new ScaledFFT(x.length, m, scale);
    return transform.transform(x, axis);
}

function czt(x, m = null, w = 1.0, a = 1, axis = -1) {
    const transform = new CZT(x.length, m, w, a);
    return transform.transform(x, axis);
}

function zoomfft(x, f1, f2 = null, m = null, Fs = 2, axis = -1) {
    const transform = new ZoomFFT(x.length, f1, f2, m, Fs);
    return transform.transform(x, axis);
}

//module.exports = { czt, zoomfft, scaledfft };
