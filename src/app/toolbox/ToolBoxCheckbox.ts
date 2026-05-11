import { Optional, ToolBoxElement } from './ToolBoxElement';
import SvgImage, { Icon } from '../ui/SvgImage';

type Icons = {
    on?: Icon;
    off: Icon;
};

export class ToolBoxCheckbox extends ToolBoxElement<HTMLInputElement> {
    private readonly input: HTMLInputElement;
    private readonly label: HTMLLabelElement;
    private readonly imageOn?: Element;
    private readonly imageOff: Element;
    constructor(title: string, icons: Icons | Icon, opt_id?: string, optional?: Optional) {
        super(title, optional);
        const input = document.createElement('input');
        input.type = 'checkbox';
        const label = document.createElement('label');
        label.title = title;
        label.classList.add('control-button');
        let iconOff: Icon;
        let iconOn: Icon | undefined;
        if (typeof icons !== 'number') {
            iconOff = icons.off;
            iconOn = icons.on;
        } else {
            iconOff = icons;
        }
        const iconSpan = document.createElement('span');
        iconSpan.classList.add('btn-icon');

        this.imageOff = SvgImage.create(iconOff);
        this.imageOff.classList.add('image', 'image-off');
        iconSpan.appendChild(this.imageOff);
        if (iconOn) {
            this.imageOn = SvgImage.create(iconOn);
            this.imageOn.classList.add('image', 'image-on');
            iconSpan.appendChild(this.imageOn);
            input.classList.add('two-images');
        }
        label.appendChild(iconSpan);

        const labelSpan = document.createElement('span');
        labelSpan.classList.add('btn-label');
        labelSpan.textContent = title;
        label.appendChild(labelSpan);
        const id = opt_id || title.toLowerCase().replace(' ', '_');
        label.htmlFor = input.id = `input_${id}`;
        this.input = input;
        this.label = label;
    }

    public getElement(): HTMLInputElement {
        return this.input;
    }

    public getAllElements(): HTMLElement[] {
        return [this.input, this.label];
    }
}
