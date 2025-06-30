'use client';

import { useEffect, useRef, useState } from 'react';
import { cn, configureAssistant, getSubjectColor } from '@/lib/utils';
import { vapi } from '@/lib/vapi.sdk';
import Image from 'next/image';
import Lottie, { LottieRefCurrentProps } from 'lottie-react';
import soundwaves from '@/constants/soundwaves.json';
import { addToSessionHistory } from '@/lib/actions/companion.actions';

enum CallStatus {
  INACTIVE = 'INACTIVE',
  CONNECTING = 'CONNECTING',
  ACTIVE = 'ACTIVE',
  FINISHED = 'FINISHED',
  ERROR = 'ERROR', // Added new status for error state
}

interface ErrorState {
  hasError: boolean;
  message: string;
}

const CompanionComponent = ({
  companionId,
  subject,
  topic,
  name,
  userName,
  userImage,
  style,
  voice,
}: CompanionComponentProps) => {
  const [callStatus, setCallStatus] = useState<CallStatus>(CallStatus.INACTIVE);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [messages, setMessages] = useState<SavedMessage[]>([]);
  const [error, setError] = useState<ErrorState>({
    hasError: false,
    message: '',
  });
  const retryTimeoutRef = useRef<NodeJS.Timeout>();
  const maxRetries = 3;
  const [retryCount, setRetryCount] = useState(0);

  const lottieRef = useRef<LottieRefCurrentProps>(null);

  useEffect(() => {
    if (lottieRef) {
      if (isSpeaking) {
        lottieRef.current?.play();
      } else {
        lottieRef.current?.stop();
      }
    }
  }, [isSpeaking, lottieRef]);

  const resetError = () => {
    setError({ hasError: false, message: '' });
  };

  const handleError = (errorMessage: string) => {
    console.error('VAPI Error:', errorMessage);
    setError({ hasError: true, message: errorMessage });
    setCallStatus(CallStatus.ERROR);
  };

  const startCall = async () => {
    try {
      resetError();
      setCallStatus(CallStatus.CONNECTING);

      const assistantOverrides = {
        variableValues: { subject, topic, style },
        clientMessages: ['transcript'],
        serverMessages: [],
      };

      await vapi.start(configureAssistant(voice, style), assistantOverrides);
    } catch (error) {
      console.error('Failed to start call:', error);
      handleError('Failed to start the call. Please try again.');
      setCallStatus(CallStatus.INACTIVE);
    }
  };

  const retryConnection = () => {
    if (retryCount < maxRetries) {
      setRetryCount((prev) => prev + 1);
      retryTimeoutRef.current = setTimeout(() => {
        console.log(
          `Retrying connection... Attempt ${retryCount + 1}/${maxRetries}`
        );
        startCall();
      }, 2000); // Wait 2 seconds before retrying
    } else {
      handleError('Maximum retry attempts reached. Please try again later.');
      setCallStatus(CallStatus.ERROR);
    }
  };

  useEffect(() => {
    const onCallStart = () => {
      setCallStatus(CallStatus.ACTIVE);
      setRetryCount(0); // Reset retry count on successful connection
      resetError();
    };

    const onCallEnd = () => {
      setCallStatus(CallStatus.FINISHED);
      addToSessionHistory(companionId);
    };

    const onMessage = (message: Message) => {
      if (message.type === 'transcript' && message.transcriptType === 'final') {
        const newMessage = { role: message.role, content: message.transcript };
        setMessages((prev) => [newMessage, ...prev]);
      }
    };

    const onSpeechStart = () => setIsSpeaking(true);
    const onSpeechEnd = () => setIsSpeaking(false);

    const onError = (error: Error) => {
      console.error('VAPI Error:', error);
      handleError(error.message || 'An error occurred during the call.');

      if (callStatus === CallStatus.CONNECTING) {
        retryConnection();
      }
    };

    vapi.on('call-start', onCallStart);
    vapi.on('call-end', onCallEnd);
    vapi.on('message', onMessage);
    vapi.on('error', onError);
    vapi.on('speech-start', onSpeechStart);
    vapi.on('speech-end', onSpeechEnd);

    return () => {
      // Clean up retry timeout if it exists
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
      }

      // Ensure we cleanup properly
      if (callStatus === CallStatus.ACTIVE) {
        vapi.stop();
      }

      vapi.off('call-start', onCallStart);
      vapi.off('call-end', onCallEnd);
      vapi.off('message', onMessage);
      vapi.off('error', onError);
      vapi.off('speech-start', onSpeechStart);
      vapi.off('speech-end', onSpeechEnd);
    };
  }, [callStatus, companionId, retryCount]);

  const toggleMicrophone = () => {
    if (callStatus !== CallStatus.ACTIVE) return;

    try {
      const isMuted = vapi.isMuted();
      vapi.setMuted(!isMuted);
      setIsMuted(!isMuted);
    } catch (error) {
      console.error('Error toggling microphone:', error);
      handleError('Failed to toggle microphone. Please try again.');
    }
  };

  const handleCall = async () => {
    if (callStatus === CallStatus.CONNECTING) {
      return; // Prevent multiple connection attempts
    }

    await startCall();
  };

  const handleDisconnect = () => {
    try {
      setCallStatus(CallStatus.FINISHED);
      vapi.stop();
    } catch (error) {
      console.error('Error disconnecting:', error);
      handleError('Failed to disconnect properly. Please refresh the page.');
    }
  };

  return (
    <section className="flex flex-col h-[70vh]">
      <section className="flex gap-8 max-sm:flex-col">
        <div className="companion-section">
          <div
            className="companion-avatar"
            style={{ backgroundColor: getSubjectColor(subject) }}
          >
            <div
              className={cn(
                'absolute transition-opacity duration-1000',
                callStatus === CallStatus.FINISHED ||
                  callStatus === CallStatus.INACTIVE
                  ? 'opacity-100'
                  : 'opacity-0',
                callStatus === CallStatus.CONNECTING &&
                  'opacity-100 animate-pulse'
              )}
            >
              <Image
                src={`/icons/${subject}.svg`}
                alt={subject}
                width={150}
                height={150}
                className="max-sm:w-fit"
              />
            </div>

            <div
              className={cn(
                'absolute transition-opacity duration-1000',
                callStatus === CallStatus.ACTIVE ? 'opacity-100' : 'opacity-0'
              )}
            >
              <Lottie
                lottieRef={lottieRef}
                animationData={soundwaves}
                autoplay={false}
                className="companion-lottie"
              />
            </div>
          </div>
          <p className="font-bold text-2xl">{name}</p>
          {error.hasError && (
            <div className="text-red-500 text-sm mt-2">
              {error.message}
              {callStatus === CallStatus.ERROR && (
                <button
                  onClick={() => {
                    setCallStatus(CallStatus.INACTIVE);
                    resetError();
                    setRetryCount(0);
                  }}
                  className="ml-2 underline"
                >
                  Try Again
                </button>
              )}
            </div>
          )}
        </div>

        <div className="user-section">
          <div className="user-avatar">
            <Image
              src={userImage}
              alt={userName}
              width={130}
              height={130}
              className="rounded-lg"
            />
            <p className="font-bold text-2xl">{userName}</p>
          </div>
          <button
            className={cn(
              'btn-mic',
              callStatus !== CallStatus.ACTIVE && 'opacity-50'
            )}
            onClick={toggleMicrophone}
            disabled={callStatus !== CallStatus.ACTIVE}
          >
            <Image
              src={isMuted ? '/icons/mic-off.svg' : '/icons/mic-on.svg'}
              alt="mic"
              width={36}
              height={36}
            />
            <p className="max-sm:hidden">
              {isMuted ? 'Turn on microphone' : 'Turn off microphone'}
            </p>
          </button>
          <button
            className={cn(
              'rounded-lg py-2 cursor-pointer transition-colors w-full text-white',
              callStatus === CallStatus.ACTIVE ? 'bg-red-700' : 'bg-primary',
              callStatus === CallStatus.CONNECTING && 'animate-pulse',
              (callStatus === CallStatus.ERROR ||
                callStatus === CallStatus.CONNECTING) &&
                'opacity-50 cursor-not-allowed'
            )}
            onClick={
              callStatus === CallStatus.ACTIVE ? handleDisconnect : handleCall
            }
            disabled={
              callStatus === CallStatus.ERROR ||
              callStatus === CallStatus.CONNECTING
            }
          >
            {callStatus === CallStatus.ACTIVE
              ? 'End Session'
              : callStatus === CallStatus.CONNECTING
              ? `Connecting${
                  retryCount > 0 ? ` (Retry ${retryCount}/${maxRetries})` : ''
                }`
              : callStatus === CallStatus.ERROR
              ? 'Connection Failed'
              : 'Start Session'}
          </button>
        </div>
      </section>

      <section className="transcript">
        <div className="transcript-message no-scrollbar">
          {messages.map((message, index) => {
            if (message.role === 'assistant') {
              return (
                <p key={index} className="max-sm:text-sm">
                  {name.split(' ')[0].replace('/[.,]/g', ',')}:{' '}
                  {message.content}
                </p>
              );
            } else {
              return (
                <p key={index} className="text-primary max-sm:text-sm">
                  {userName}: {message.content}
                </p>
              );
            }
          })}
        </div>
        <div className="transcript-fade" />
      </section>
    </section>
  );
};

export default CompanionComponent;
