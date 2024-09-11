//const math = require('mathjs'); // For mathematical operations

function cztSeq(totalTime, omgMin, omgMax, ...xseqs) {
    const freq = Array.from({ length: xseqs[0].length }, (_, i) => omgMin + i * (omgMax - omgMin) / (xseqs[0].length - 1));
    const res = [freq];
    
    for (const xSeq of xseqs) {
        if (xseqs[0].length !== xSeq.length) {
            throw new Error("Length of data must be equal!");
        }
        const fftS = zoomfft(xSeq, omgMin / Math.PI / 2, omgMax / Math.PI / 2, xseqs[0].length / totalTime);
        res.push(fftS);
    }
    
    return res;
}

class MultiSignalSpectrum {
    constructor(sampleRate, omgMin, omgMax, xSeqs, winNum = 16) {
        this.sampleRate = sampleRate;
        this.xSeqs = xSeqs;
        this.winNum = winNum;
        this.perWinTime = 0;
        this.dataWindows = [];
        this.dataNum = xSeqs.length;
        this.omgMin = omgMin;
        this.omgMax = omgMax;
        this.fftArray = [];
        this.fftFreq = [];
        this.totalTime = xSeqs[0].length / sampleRate;

        this.calcFftForSeqs();
    }

    getGxxByIndex(seqIndex) {
        const gxxArray = [];
        for (let i = 0; i < this.winNum; i++) {
            const xFft = this.fftArray[seqIndex][i];
            gxxArray.push(MultiSignalSpectrum.getGxx(xFft, this.perWinTime));
        }
        const gxx = math.mean(gxxArray, 0) / 0.612;
        return [this.fftFreq, gxx];
    }

    getGxyByIndex(xIndex, yIndex) {
        const gxyArray = [];
        for (let i = 0; i < this.winNum; i++) {
            const xFft = this.fftArray[xIndex][i];
            const yFft = this.fftArray[yIndex][i];
            gxyArray.push(MultiSignalSpectrum.getGxy(xFft, yFft, this.perWinTime));
        }
        const gxy = math.mean(gxyArray, 0) / 0.612;
        return [this.fftFreq, gxy];
    }

    calcFftForSeqs() {
        this.cutDatasToWindows();
        for (let j = 0; j < this.dataNum; j++) {
            const xWins = this.dataWindows[j];
            const xFftWins = [];
            for (let i = 0; i < this.winNum; i++) {
                const winXSeq = xWins[i];
                const [fftFreq, xFft] = cztSeq(this.perWinTime, this.omgMin, this.omgMax, winXSeq);
                xFftWins.push(xFft);
            }
            this.fftArray.push(xFftWins);
        }
        return [this.fftFreq, this.fftArray];
    }

    cutDatasToWindows() {
        const winNum = this.winNum;
        const datas = this.xSeqs;
        const perWinLength = 2 * Math.floor(datas[0].length / winNum);
        const deltaWin = Math.floor(perWinLength / 2);
        const res = [];

        for (const data of datas) {
            if (data.length !== datas[0].length) {
                throw new Error("The length of input data sequences must be equal");
            }
            const windows = MultiSignalSpectrum.cutDataSeqToWindows(winNum, deltaWin, perWinLength, data);
            res.push(windows);
        }

        this.dataWindows = res;
        this.perWinTime = perWinLength / this.sampleRate;
        return res;
    }

    static getGxx(xFft, T) {
        return Math.square(Math.abs(xFft)) * 2 / T;
    }

    static getGxy(xFft, yFft, T) {
        return Math.dotMultiply(xFft.conj(), yFft) * 2 / T;
    }

    static cutDataSeqToWindows(winNum, delta, perWinLength, data) {
        const windows = [];
        for (let i = 0; i < winNum; i++) {
            let winData = data.slice(i * delta, i * delta + perWinLength);
            if (i * delta + perWinLength > data.length) {
                const addLen = i * delta + perWinLength - data.length;
                const addArr = new Array(addLen).fill(0);
                winData = winData.concat(addArr);
            }
            winData = MultiSignalSpectrum.addHanningWindow(winData);
            windows.push(winData);
        }
        return windows;
    }

    static addHanningWindow(data) {
        const dataLen = data.length;
        for (let j = 0; j < dataLen; j++) {
            const t = 2 * Math.PI * j / dataLen;
            const wt = (1 - Math.cos(t)) * 0.5;
            data[j] *= wt;
       
        }
        return data;
    }
}

//module.exports = { MultiSignalSpectrum, cztSeq };

// For testing and usage, make sure to replace 'zoomfft' and other external dependencies with actual implementations.
