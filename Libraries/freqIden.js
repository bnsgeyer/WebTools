// Import required library for interpolation (using mathjs for numerical operations)
//const math = require('mathjs'); // Make sure to install mathjs with npm

function removeSeqAverageAndDrift(xSeq) {
    sum_xseq = 0;
    for (let i = 0;i < xSeq.length; i++) {
        sum_xseq += xSeq[i];
    }
    const avg = sum_xseq/xSeq.length;
    xSeq = xSeq.map(x => x - avg);
    const drift = xSeq[xSeq.length - 1] - xSeq[0];
    const startV = xSeq[0];
    xSeq = xSeq.map((x, i) => x - drift * i / xSeq.length - startV);
    return xSeq;
}

function interpolate(x, y, newX) {
    const result = [];
    for (let i = 0; i < newX.length; i++) {
        const xi = newX[i];
        if (xi <= x[0]) {
            result.push(y[0]);
        } else if (xi >= x[x.length - 1]) {
            result.push(y[y.length - 1]);
        } else {
            let j = 0;
            while (xi > x[j + 1]) j++;
            const t = (xi - x[j]) / (x[j + 1] - x[j]);
            result.push(y[j] + t * (y[j + 1] - y[j]));
        }
    }
    return result;
}

function timeSeqPreprocess(timeSeq, enable_resample=true, remove_drift_and_avg=true, ...xSeqs) {
    let tnew = timeSeq;
    if (enable_resample) { // Enable resample is true by default
        tnew = [];
        const num = timeSeq.length;
        const step = (timeSeq[timeSeq.length - 1] - timeSeq[0]) / (num - 1);
        for (let i = 0; i < num; i++) {
            tnew.push(timeSeq[0] + i * step);
        }
    }

    const sampleRate = timeSeq.length / (timeSeq[timeSeq.length - 1] - timeSeq[0]);
    console.log(`timeseq start is ${timeSeq[0]}`);
    console.log(`timeseq end is ${timeSeq[timeSeq.length - 1]}`);
    console.log(`Sample rate is ${sampleRate.toFixed(1)} Hz`);
    let resampledDatas = [tnew];

    for (let xSeq of xSeqs) {
        if (xSeq.length !== tnew.length) {
            throw new Error("Length of data seq must be equal to time seq");
        }
        xSeq = xSeq.slice(); // Deep copy
        if (remove_drift_and_avg) { // Remove drift and avg is true by default
            xSeq = removeSeqAverageAndDrift(xSeq);
        }
        let data = xSeq;
        if (enable_resample) { // Enable resample is true by default
            data = interpolate(timeSeq, xSeq, tnew);
        }
        resampledDatas.push(data);
    }
    return resampledDatas;
}


class FreqIdenSIMO {
    constructor(timeSeq, omgMin, omgMax, win_num=undefined, uniform_input=false, assit_input=undefined, xSeq, ...ySeqs) {
        // Process time sequences and data
        [this.timeSeq, this.xSeq] = timeSeqPreprocess(timeSeq, !uniform_input, true, xSeq);
        this.trims = ySeqs.map(ySeq => ySeq[0]);

        let [ , ...processedYSeqs] = timeSeqPreprocess(timeSeq, !uniform_input, true, ...ySeqs);
        this.ySeqs = processedYSeqs;

        this.enableAssitInput = false;

        if (assit_input !== undefined) {
            [ , this.x2Seq] = timeSeqPreprocess(timeSeq, assit_input, true, !uniform_input);
            this.enableAssitInput = true;
        }

        this.timeLen = this.timeSeq[this.timeSeq.length - 1] - this.timeSeq[0];
        this.sampleRate = this.timeSeq.length / this.timeLen;
        this.omgMin = omgMin;
        this.omgMax = omgMax;

        this.usingComposite = win_num === null;

    //    try {
        let datas = [...this.ySeqs];
        if (this.enableAssitInput) datas.push(this.x2Seq);
        datas.push([...this.xSeq]);
        console.log(`Start calc spectrum for data: totalTime ${this.timeLen} sample rate ${this.sampleRate}`);
        this.spectrumAnal = new MultiSignalSpectrum(this.sampleRate, omgMin, omgMax, datas, win_num);
    //    } catch (error) {
    //        if (error instanceof KeyboardInterrupt) throw error;
    //    }
    }

    getCrossCoherence(index1, index2) {
        if (this.enableAssitInput) {
            let [ , gxx] = this.spectrumAnal.getGxxByIndex(index1);
            let [ , gaa] = this.spectrumAnal.getGxxByIndex(index2);
            let [ , gxa] = this.spectrumAnal.getGxyByIndex(index1, index2);
            let gxa2 = Math.abs(gxa) ** 2;
            return gxa2 / (gxx * gaa);
        } else {
            return 1;
        }
    }

    getAssitXxNorm() {
        return this.enableAssitInput ? 1 - this.getCrossCoherence(-1, -2) : 1;
    }

    getAssitYyNorm(yIndex) {
        return this.enableAssitInput ? 1 - this.getCrossCoherence(-2, yIndex) : 1;
    }

    getAssitXyNorm(yIndex = 0) {
        if (this.enableAssitInput) {
            let [ , gaa] = this.spectrumAnal.getGxxByIndex(-2);
            let [ , gxa] = this.spectrumAnal.getGxyByIndex(-1, -2);
            let [ , gay] = this.spectrumAnal.getGxyByIndex(-2, yIndex);
            let [ , gxy] = this.spectrumAnal.getGxyByIndex(-1, yIndex);
            return 1 - (gxa * gay) / (gaa * gxy);
        } else {
            return 1;
        }
    }

    getFreqIden(yIndex = 0) {
        if (!this.usingComposite) {
            let [freq, gxx] = this.spectrumAnal.getGxxByIndex(-1);
            if (this.enableAssitInput) gxx *= this.getAssitXxNorm();
            let [ , gxy] = this.spectrumAnal.getGxyByIndex(-1, yIndex);
            if (this.enableAssitInput) gxy *= this.getAssitXyNorm(yIndex);
            let [ , gyy] = this.spectrumAnal.getGxxByIndex(yIndex);
            let H = FreqIdenSIMO.getHFromGxyGxx(gxy, gxx);
            let gamma2 = FreqIdenSIMO.getCoherence(gxx, gxy, gyy);
            return [freq, H, gamma2, gxx, gxy, gyy];
        } else {
            let compose = this.composes[yIndex];
            return [compose.freq, compose.gxx, compose.gxy, compose.gyy];
        }
    }

    getFreqres(indexs = null) {
        let Hs = [];
        let coheres = [];
        let freq = null;
        indexs = indexs || Array.from({ length: this.ySeqs.length }, (_, i) => i);
        indexs.forEach(i => {
            [freq, h, co] = this.getFreqIden(i);
            Hs.push(h);
            coheres.push(co);
        });
        return new FreqResponse(freq, Hs, coheres, this.trims);
    }

    saveToCsv(index, path) {
        let [freq, H, gamma2, gxx, gxy, gyy] = this.getFreqIden(index);
        let exdata = freq.map((f, i) => [f, Math.re(H[i]), Math.im(H[i])]);
        // Use a library like `fs` to write to CSV
        require('fs').writeFileSync(path, exdata.map(row => row.join(',')).join('\n'));
    }

    returnPlottingData() {
        let [freq, H, gamma2, gxx, gxy, gyy] = this.getFreqIden(0);
        let [hAmp, hPhase] = FreqIdenSIMO.getAmpPhaFromH(H);
        return [freq, hAmp, hPhase, gamma2, gxx, gxy, gyy, H];
    }

    // Static methods need to be defined separately if they are used in the class
    static getHFromGxyGxx(gxy, gxx) {
        // Implement the static method
    }

    static getCoherence(gxx, gxy, gyy) {
        // Implement the static method
    }

    static getAmpPhaFromH(H) {
        // Implement the static method
    }
}

