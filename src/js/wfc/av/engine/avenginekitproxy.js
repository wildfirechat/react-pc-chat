/*
 * Copyright (c) 2020 WildFireChat. All rights reserved.
 */

import EventType from "../../client/wfcEvent";
import {AppPath, BrowserWindow, ipcRenderer, isElectron, PostMessageEventEmitter} from "../../../platform";
import ConversationType from "../../model/conversationType";
import MessageContentType from "../../messages/messageContentType";
import wfc from "../../client/wfc";
import MessageConfig from "../../client/messageConfig";
import CallByeMessageContent from "../messages/callByeMessageContent";
import DetectRTC from 'detectrtc';
import Config from "../../../config";
import {longValue, numberValue} from '../../util/longUtil'
import CallEndReason from './callEndReason'
import Conversation from "../../../wfc/model/conversation";

const path = require('path');

// main window renderer process -> voip window renderer process
// voip window renderer process -> main process -> main window renderer process
export class AvEngineKitProxy {
    queueEvents;
    callWin;

    conversation;
    callId;
    participants = [];
    isSupportVoip = false;
    hasMicrophone = false;
    hasSpeaker = false;
    hasWebcam = false;

    /**
     * 应用初始化的时候调用
     * @param wfc
     */
    setup(wfc) {
        DetectRTC.load(() => {
            this.isSupportVoip = DetectRTC.isWebRTCSupported;
            this.hasMicrophone = DetectRTC.hasMicrophone;
            // Safari 14.0 版本，hasSpeakers一直为false，先全部置为true
            //this.hasSpeaker = DetectRTC.hasSpeakers;
            this.hasSpeaker = true;
            this.hasWebcam = DetectRTC.hasWebcam;
            console.log(`detectRTC, isWebRTCSupported: ${DetectRTC.isWebRTCSupported}, hasWebcam: ${DetectRTC.hasWebcam}, hasSpeakers: ${DetectRTC.hasSpeakers}, hasMicrophone: ${DetectRTC.hasMicrophone}`, this.isSupportVoip);
        });
        this.event = wfc.eventEmitter;
        this.event.on(EventType.ReceiveMessage, this.onReceiveMessage);
        this.event.on(EventType.ConferenceEvent, this.onReceiveConferenceEvent)

        if (isElectron()) {
            ipcRenderer.on('voip-message', this.sendVoipListener);
            ipcRenderer.on('conference-request', this.sendConferenceRequestListener);
            ipcRenderer.on('update-call-start-message', this.updateCallStartMessageContentListener)
        }
    }

    updateCallStartMessageContentListener = (event, message) => {
        let messageUid = message.messageUid;
        let content = message.content;

        let msg = wfc.getMessageByUid(messageUid);
        let orgContent = msg.messageContent;
        orgContent.connectTime = content.connectTime ? content.connectTime : orgContent.connectTime;
        orgContent.endTime = content.endTime ? content.endTime : orgContent.endTime;
        orgContent.status = content.status;
        orgContent.audioOnly = content.audioOnly;
        wfc.updateMessageContent(msg.messageId, orgContent);
    }

    sendConferenceRequestListener = (event, request) =>{
        wfc.sendConferenceRequest(request.sessionId ? request.sessionId : 0, request.roomId ? request.roomId : '', request.request, request.data, (errorCode, res) => {
            this.emitToVoip('sendConferenceRequestResult', {
                error: errorCode,
                sendConferenceRequestId: request.sendConferenceRequestId,
                response: res
            })
        });
    }

    // 发送消息时，返回的timestamp，已经过修正，后面使用时,不用考虑和服务器的时间差
    sendVoipListener = (event, msg) => {

        let contentClazz = MessageConfig.getMessageContentClazz(msg.content.type);

        let content = new contentClazz();
        content.decode(msg.content);
        console.log('to send voip message', content);
        let delta = wfc.getServerDeltaTime();
        console.log('delta', delta);
        if (content.type === MessageContentType.VOIP_CONTENT_TYPE_ADD_PARTICIPANT) {
            this.participants.push(content.participants);
        } else if (content.type === MessageContentType.VOIP_CONTENT_TYPE_END) {
            this.conversation = null;
            this.callId = null;
            this.participants = [];
            // 仅仅为了通知proxy，其他端已经接听电话了，关闭窗口时，不应当发送挂断信令
            if (!content.callId) {
                return;
            }
        }
        let conversation = new Conversation(msg.conversation.type, msg.conversation.target, msg.conversation.line)
        wfc.sendConversationMessage(conversation, content, msg.toUsers, (messageId, timestamp) => {

            // do nothing
        }, (uploaded, total) => {

            // do nothing
        }, (messageUid, timestamp) => {
            this.emitToVoip('sendMessageResult', {
                error: 0,
                sendMessageId: msg.sendMessageId,
                messageUid: messageUid,
                timestamp: longValue(numberValue(timestamp) - delta)
            })
        }, (errorCode) => {
            this.emitToVoip('sendMessageResult', {error: errorCode, sendMessageId: msg.sendMessageId})
        });
    }

    onReceiveConferenceEvent = (event) =>{
        this.emitToVoip("conferenceEvent", event);
    }

    // 收到消息时，timestamp已经过修正，后面使用时，不用考虑和服务器的时间差
    onReceiveMessage = (msg) => {
        //if (!this.isSupportVoip || !this.hasSpeaker || !this.hasMicrophone) {
        if (!this.isSupportVoip) {
            console.log('not support voip, just ignore voip message')
            return;
        }
        if (!Config.ENABLE_MULTI_VOIP_CALL && msg.conversation.type === ConversationType.Group) {
            console.log('not enable multi call ');
            return;
        }
        if (!Config.ENABLE_SINGLE_VOIP_CALL && msg.conversation.type === ConversationType.Single) {
            console.log('not enable multi call ');
            return;
        }
        let content = msg.messageContent;
        if(content.type === MessageContentType.VOIP_CONTENT_TYPE_START
            || content.type === MessageContentType.VOIP_CONTENT_TYPE_ADD_PARTICIPANT ){
            if(!content.audioOnly && !this.hasWebcam){
                console.log('do not have webcam, can not start video call');
                return ;
            }
        }
        let now = (new Date()).valueOf();
        let delta = wfc.getServerDeltaTime();
        if ((msg.conversation.type === ConversationType.Single || msg.conversation.type === ConversationType.Group) && now - (numberValue(msg.timestamp) - delta) < 90 * 1000) {
            if (content.type === MessageContentType.VOIP_CONTENT_TYPE_START
                || content.type === MessageContentType.VOIP_CONTENT_TYPE_END
                || content.type === MessageContentType.VOIP_CONTENT_TYPE_ACCEPT
                || content.type === MessageContentType.VOIP_CONTENT_TYPE_SIGNAL
                || content.type === MessageContentType.VOIP_CONTENT_TYPE_MODIFY
                || content.type === MessageContentType.VOIP_CONTENT_TYPE_ACCEPT_T
                || content.type === MessageContentType.VOIP_CONTENT_TYPE_ADD_PARTICIPANT
                || content.type === MessageContentType.VOIP_CONTENT_TYPE_MUTE_VIDEO
            ) {
                console.log("receive voip message", msg.messageContent.type, msg.messageUid.toString(), msg);
                if(msg.direction === 0
                    && content.type !== MessageContentType.VOIP_CONTENT_TYPE_END
                    && content.type !== MessageContentType.VOIP_CONTENT_TYPE_ACCEPT
                    && content.type !== MessageContentType.VOIP_CONTENT_TYPE_ACCEPT){
                    return;
                }

                let participantUserInfos = [];
                let selfUserInfo = wfc.getUserInfo(wfc.getUserId());
                if (content.type === MessageContentType.VOIP_CONTENT_TYPE_START) {
                    this.conversation = msg.conversation;
                    this.callId = content.callId;
                    this.participants.push(...content.targetIds);
                    this.participants.push(msg.from);
                    // 参与者不包含自己
                    this.participants = this.participants.filter(uid => uid !== selfUserInfo.uid)

                    if (msg.conversation.type === ConversationType.Single) {
                        participantUserInfos = [wfc.getUserInfo(msg.from)];
                    } else {
                        let targetIds = content.targetIds.filter(id => id !== selfUserInfo.uid);
                        targetIds.push(msg.from);
                        participantUserInfos = wfc.getUserInfos(targetIds, msg.conversation.target);
                    }
                    if (!this.callWin) {
                        this.showCallUI(msg.conversation);
                    }
                } else if (content.type === MessageContentType.VOIP_CONTENT_TYPE_ADD_PARTICIPANT) {
                    let participantIds = [...content.participants];
                    if (content.existParticipants) {
                        content.existParticipants.forEach(p => {
                            participantIds.push(p.userId);
                        });
                    }

                    this.conversation = msg.conversation;
                    this.callId = content.callId;
                    this.participants.push(...participantIds);

                    participantIds = participantIds.filter(u => u.uid !== selfUserInfo.uid);
                    participantUserInfos = wfc.getUserInfos(participantIds, msg.conversation.target);

                    if (!this.callWin && content.participants.indexOf(selfUserInfo.uid) > -1) {
                        this.showCallUI(msg.conversation);
                    }
                } else if (content.type === MessageContentType.VOIP_CONTENT_TYPE_END) {
                    this.conversation = null;
                    this.callId = null;
                    this.participants = [];
                }

                if (msg.conversation.type === ConversationType.Group
                    && (content.type === MessageContentType.VOIP_CONTENT_TYPE_START
                        || content.type === MessageContentType.VOIP_CONTENT_TYPE_ADD_PARTICIPANT
                    )) {
                    let memberIds = wfc.getGroupMemberIds(msg.conversation.target);
                    msg.groupMemberUserInfos = wfc.getUserInfos(memberIds, msg.conversation.target);
                }

                msg.participantUserInfos = participantUserInfos;
                msg.selfUserInfo = selfUserInfo;
                msg.timestamp = longValue(numberValue(msg.timestamp) - delta)
                this.emitToVoip("message", msg);
            }
        }
    };

    emitToVoip(event, args) {
        if (isElectron()) {
            // renderer/main to renderer
            if (this.callWin) {
                this.callWin.webContents.send(event, args);
            } else if (this.queueEvents) {
                this.queueEvents.push({event, args});
            }
        } else {
            if (this.events) {
                this.events.emit(event, args);
            } else if (this.queueEvents) {
                this.queueEvents.push({event, args});
            }
        }
    }

    listenMainEvent(event, listener) {
        if (isElectron()) {
            // listen for event from main
            ipcRenderer.on(event, listener);
        } else {
            this.events.on(event, listener);
        }
    }

    emitToMain(event, args) {
        console.log('emit to main', event, args);
        if (isElectron()) {
            // renderer to main
            ipcRenderer.send(event, args);
        } else {
            this.events.emit(event, args);
        }
    }

    listenVoipEvent = (event, listener) => {
        if (isElectron()) {
            // listen for event from renderer
            ipcRenderer.on(event, listener);
        } else {
            if (!this.events) {
                this.events = new PostMessageEventEmitter(window.opener, window.location.origin);
            }
            this.events.on(event, listener);
        }
    };

    startCall(conversation, audioOnly, participants) {
        if(this.callWin){
            console.log('voip call is ongoing');
            return ;
        }
        if(!this.isSupportVoip || !this.hasSpeaker || !this.hasMicrophone || (!audioOnly && !this.hasWebcam)){
            console.log('not support voip', this.isSupportVoip, this.hasSpeaker, this.hasMicrophone);
            return;
        }
        let selfUserInfo = wfc.getUserInfo(wfc.getUserId());
        participants = participants.filter(uid => uid !== selfUserInfo.uid);
        let callId = conversation.target + Math.floor(Math.random() * 10000);
        this.conversation = conversation;
        this.participants.push(...participants)
        this.callId = callId;

        let participantUserInfos = wfc.getUserInfos(participants);
        let groupMemberUserInfos;
        if (conversation.type === ConversationType.Group) {
            let memberIds = wfc.getGroupMemberIds(conversation.target);
            groupMemberUserInfos = wfc.getUserInfos(memberIds, conversation.target);
        }
        this.showCallUI(conversation);
        this.emitToVoip('startCall', {
            conversation: conversation,
            audioOnly: audioOnly,
            callId: callId,
            selfUserInfo: selfUserInfo,
            groupMemberUserInfos: groupMemberUserInfos,
            participantUserInfos: participantUserInfos
        });
    }

    startConference(callId, audioOnly, pin, host, title, desc, audience) {
        if(this.callWin){
            console.log('voip call is ongoing');
            return ;
        }
        //if (!this.isSupportVoip || !this.hasSpeaker || !this.hasMicrophone || (!audioOnly && !this.hasWebcam)) {
        if (!this.isSupportVoip) {
            console.log('not support voip', this.isSupportVoip, this.hasSpeaker);
            return;
        }

        callId = callId  ? callId : wfc.getUserId() + Math.floor(Math.random() * 10000);
        this.callId = callId;

        let selfUserInfo = wfc.getUserInfo(wfc.getUserId());
        this.showCallUI(null, true);
        this.emitToVoip('startConference', {
            audioOnly: audioOnly,
            callId: callId,
            pin: pin,
            host: host,
            title: title,
            desc: desc,
            audience:audience,
            selfUserInfo: selfUserInfo,
        });
    }

    showCallUI(conversation, isConference) {
        this.queueEvents = [];
        let type = isConference ? 'voip-conference' : (conversation.type === ConversationType.Single ? 'voip-single' : 'voip-multi');
        if (isElectron()) {
            let win = new BrowserWindow(
                {
                    width: 360,
                    height: 640 + 15,
                    resizable: true,
                    maximizable: true,
                    webPreferences: {
                        scrollBounce: true,
                        nativeWindowOpen: true,
                        nodeIntegration: true,
                    },
                }
            );

            win.webContents.on('did-finish-load', () => {
                this.onVoipWindowReady(win);
            });
            // win.webContents.openDevTools();
            win.on('close', () => {
                this.onVoipWindowClose();
            });

            win.loadURL(path.join('file://', AppPath, 'src/index.html?' + type));
            win.show();
        } else {
            let win = window.open(window.location.origin + '?' + type, '_blank', 'width=360,height=640,left=200,top=200,toolbar=no,menubar=no,resizable=no,location=no, maximizable');
            if(!win){
                console.log('can not open voip window');
                return;
            }
            win.addEventListener('load', () => {
                this.onVoipWindowReady(win);
            }, true);

            win.addEventListener('beforeunload', (event) => {
                this.onVoipWindowClose(event);
            });
        }
    }

    onVoipWindowClose(event) {
        if(event && event.srcElement && event.srcElement.URL === 'about:blank'){
            // fix safari bug: safari 浏览器，页面刚打开的时候，也会走到这个地方
            return;
        }
        if (this.conversation) {
            let byeMessage = new CallByeMessageContent();
            byeMessage.callId = this.callId;
            byeMessage.reason = CallEndReason.RemoteNetworkError;
            wfc.sendConversationMessage(this.conversation, byeMessage, this.participants);
            this.conversation = null;
            this.callId = null;
            this.participants = [];
        }
        this.callWin = null;
        this.voipEventRemoveAllListeners(['message']);
    }

    onVoipWindowReady(win) {
        this.callWin = win;
        if (!isElectron()) {
            this.events = new PostMessageEventEmitter(win, window.location.origin)
            this.events.on('voip-message', this.sendVoipListener)
            this.events.on('conference-request', this.sendConferenceRequestListener);
            this.events.on('update-call-start-message', this.updateCallStartMessageContentListener)
        }
        if (this.queueEvents.length > 0) {
            this.queueEvents.forEach((eventArgs) => {
                console.log('process queued event');
                this.emitToVoip(eventArgs.event, eventArgs.args);
            })
        }
    }

    voipEventRemoveAllListeners(events = []) {
        if (isElectron()) {
            // renderer
            events.forEach(e => ipcRenderer.removeAllListeners(e));
        } else {
            if(this.events){
            this.events.stop();
            this.events = null;
            }
        }
    }
}

const self = new AvEngineKitProxy();
export default self;
