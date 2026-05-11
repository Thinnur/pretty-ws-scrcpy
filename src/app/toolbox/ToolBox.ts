import { ToolBoxElement } from './ToolBoxElement';

export class ToolBox {
    private readonly holder: HTMLElement;

    constructor(list: ToolBoxElement<any>[]) {
        this.holder = document.createElement('div');
        this.holder.classList.add('control-buttons-list', 'control-wrapper');

        const header = document.createElement('div');
        header.classList.add('toolbox-header');
        const titleEl = document.createElement('span');
        titleEl.classList.add('toolbox-title');
        titleEl.textContent = 'Controls';
        header.appendChild(titleEl);
        this.holder.appendChild(header);

        list.forEach((item) => {
            item.getAllElements().forEach((el) => {
                this.holder.appendChild(el);
            });
        });
    }

    public getHolderElement(): HTMLElement {
        return this.holder;
    }
}
