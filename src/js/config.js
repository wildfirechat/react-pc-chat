import {isElectron} from './platform'

export default class Config {
    // 是否支持多人音视频通话
    static ENABLE_MULTI_VOIP_CALL = true;
    // 是否支持1对1音视频通话
    static ENABLE_SINGLE_VOIP_CALL = true;
    // 打开voip调试模式时，voip window不会自动关闭，方便分析控制台日志，需要手动关闭。
    static ENABLE_VOIP_DEBUG_MODE = false;
    // 挂断音视频通话后，音视频通话窗口延时多久关闭，单位是秒。
    static VOIP_WINDOW_CLOSE_DELAY = 2;

    static DEFAULT_PORTRAIT_URL = 'https://static.wildfirechat.net/user-fallback.png';

    //默认demo应用服务的端口是8888，地址配置为 http://${应用服务器地址}:8888 上线需要切换成https的地址。
    //static APP_SERVER = 'http://wildfirechat.net:8888';
    static APP_SERVER = 'https://app.wildfirechat.net';

    static QR_CODE_PREFIX_PC_SESSION = "wildfirechat://pcsession/";
    // turn server 配置，可以添加多个
    static ICE_SERVERS = [{uri: 'turn:turn.wildfirechat.net:3478', userName: 'wfchat', password: 'wfchat'}];
    static LANGUAGE = 'zh_CN';

    static getWFCPlatform() {
        if (isElectron()) {
            if (window.process && window.process.platform === 'darwin') {
                // osx
                return 4;
            } else {
                // windows
                return 3;
            }

        } else {
            // web
            return 5;
        }
    }
}
