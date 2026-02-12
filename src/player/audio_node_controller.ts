import { clamp } from "@/math/vector2";

export class AudioNodeController {
    protected audio_context: AudioContext;
    protected gain_node: GainNode;

    constructor(context: AudioContext) {
        this.audio_context = context;
        this.gain_node = this.audio_context.createGain();
        this.gain_node.connect(this.audio_context.destination);
    }

    set_volume(volume: number): void {
        this.gain_node.gain.value = clamp(volume, 0, 1);
    }

    protected dispose_audio_node(): void {
        this.gain_node.disconnect();
    }
}
