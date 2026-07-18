(() => {
    const controllers = new Map();
    let active = null;
    const menu = document.createElement('div');
    menu.className = 'app-select-menu';
    menu.setAttribute('role', 'listbox');
    menu.tabIndex = -1;

    function optionRows(select){
        const rows = [];
        [...select.children].forEach(child => {
            if(child.tagName === 'OPTGROUP'){
                rows.push({group:true, label:child.label});
                [...child.children].forEach(option => rows.push({option}));
            } else if(child.tagName === 'OPTION') rows.push({option:child});
        });
        return rows;
    }
    function selectedText(select){
        return select.selectedOptions?.[0]?.textContent?.trim() || select.options?.[select.selectedIndex]?.textContent?.trim() || '';
    }
    function sync(controller){
        const {select, shell, trigger, label, baseStyle} = controller;
        if(!select.isConnected) return;
        const style = getComputedStyle(select);
        shell.hidden = select.hidden || style.display === 'none';
        shell.style.flex = style.flex !== '0 1 auto' || !baseStyle ? style.flex : baseStyle.flex;
        shell.style.order = style.order !== '0' || !baseStyle ? style.order : baseStyle.order;
        shell.style.alignSelf = style.alignSelf !== 'auto' || !baseStyle ? style.alignSelf : baseStyle.alignSelf;
        shell.style.justifySelf = style.justifySelf !== 'auto' || !baseStyle ? style.justifySelf : baseStyle.justifySelf;
        shell.style.gridArea = style.gridArea !== 'auto' || !baseStyle ? style.gridArea : baseStyle.gridArea;
        shell.style.margin = baseStyle?.margin || style.margin;
        shell.style.width = baseStyle?.width || style.width;
        shell.style.minWidth = baseStyle?.minWidth || style.minWidth;
        shell.style.maxWidth = baseStyle?.maxWidth || style.maxWidth;
        shell.style.height = baseStyle?.height || style.height;
        shell.style.fontFamily = style.fontFamily;
        shell.style.fontSize = style.fontSize;
        shell.style.fontWeight = style.fontWeight;
        shell.style.lineHeight = style.lineHeight;
        shell.style.setProperty('--app-select-bg', style.backgroundColor);
        shell.style.setProperty('--app-select-color', style.color);
        shell.style.setProperty('--app-select-border-color', style.borderColor);
        shell.style.setProperty('--app-select-border-width', style.borderTopWidth);
        shell.style.setProperty('--app-select-radius', style.borderRadius);
        shell.style.setProperty('--app-select-padding-left', style.paddingLeft);
        shell.style.setProperty('--app-select-padding-top', style.paddingTop);
        shell.style.setProperty('--app-select-padding-bottom', style.paddingBottom);
        label.textContent = selectedText(select);
        trigger.title = select.title || label.textContent;
        trigger.disabled = select.disabled;
        trigger.setAttribute('aria-expanded', active === controller ? 'true' : 'false');
        trigger.setAttribute('aria-label', select.getAttribute('aria-label') || select.title || selectedText(select) || '选择');
        if(active === controller) buildMenu(controller);
    }
    function positionMenu(controller){
        const rect = controller.trigger.getBoundingClientRect();
        const gap = 5;
        const below = innerHeight - rect.bottom - gap - 8;
        const above = rect.top - gap - 8;
        const openAbove = below < 180 && above > below;
        const maxHeight = Math.max(96, Math.min(360, openAbove ? above : below));
        menu.style.minWidth = `${Math.max(120, rect.width)}px`;
        menu.style.maxHeight = `${maxHeight}px`;
        menu.style.left = `${Math.max(8, Math.min(rect.left, innerWidth - Math.max(120, rect.width) - 8))}px`;
        menu.style.top = openAbove ? 'auto' : `${rect.bottom + gap}px`;
        menu.style.bottom = openAbove ? `${innerHeight - rect.top + gap}px` : 'auto';
        menu.classList.toggle('above', openAbove);
    }
    function focusOption(index){
        const options = [...menu.querySelectorAll('.app-select-option:not(:disabled)')];
        if(!options.length) return;
        const target = options[Math.max(0, Math.min(options.length - 1, index))];
        options.forEach(item => item.classList.toggle('is-focused', item === target));
        target.focus({preventScroll:true});
        target.scrollIntoView({block:'nearest'});
    }
    function buildMenu(controller){
        menu.replaceChildren();
        optionRows(controller.select).forEach(row => {
            if(row.group){
                const label = document.createElement('div');
                label.className = 'app-select-group';
                label.textContent = row.label || '';
                menu.appendChild(label);
                return;
            }
            const option = row.option;
            const button = document.createElement('button');
            button.type = 'button';
            button.className = `app-select-option${option.selected ? ' is-selected' : ''}`;
            button.textContent = option.textContent || option.value;
            button.disabled = option.disabled;
            button.dataset.value = option.value;
            button.setAttribute('role', 'option');
            button.setAttribute('aria-selected', option.selected ? 'true' : 'false');
            menu.appendChild(button);
        });
        positionMenu(controller);
    }
    function close(options={}){
        if(!active) return;
        const previous = active;
        active = null;
        previous.shell.classList.remove('is-open');
        previous.trigger.setAttribute('aria-expanded', 'false');
        menu.classList.remove('open','above');
        menu.style.display = 'none';
        if(options.focus !== false) previous.trigger.focus({preventScroll:true});
    }
    function open(controller){
        if(controller.select.disabled) return;
        if(active === controller){ close(); return; }
        close({focus:false});
        active = controller;
        controller.shell.classList.add('is-open');
        controller.trigger.setAttribute('aria-expanded','true');
        buildMenu(controller);
        menu.style.display = 'block';
        requestAnimationFrame(() => {
            if(active !== controller) return;
            menu.classList.add('open');
            const enabled = [...menu.querySelectorAll('.app-select-option:not(:disabled)')];
            const selectedIndex = enabled.findIndex(item => item.classList.contains('is-selected'));
            focusOption(selectedIndex < 0 ? 0 : selectedIndex);
        });
    }
    function choose(value){
        if(!active) return;
        const controller = active;
        if(controller.select.value !== value){
            controller.select.value = value;
            controller.select.dispatchEvent(new Event('input',{bubbles:true}));
            controller.select.dispatchEvent(new Event('change',{bubbles:true}));
        }
        sync(controller);
        close();
    }
    function enhance(select){
        if(!(select instanceof HTMLSelectElement) || select.multiple || select.size > 1 || select.dataset.nativeSelect != null || controllers.has(select)) return;
        const original = getComputedStyle(select);
        const baseStyle = {
            flex:original.flex, order:original.order, alignSelf:original.alignSelf, justifySelf:original.justifySelf,
            gridArea:original.gridArea, margin:original.margin, width:original.width, minWidth:original.minWidth,
            maxWidth:original.maxWidth, height:original.height
        };
        const shell = document.createElement('span');
        shell.className = 'app-select-shell';
        const trigger = document.createElement('button');
        trigger.type = 'button';
        trigger.className = 'app-select-trigger';
        trigger.setAttribute('aria-haspopup','listbox');
        const label = document.createElement('span');
        label.className = 'app-select-trigger-label';
        trigger.appendChild(label);
        select.before(shell);
        shell.append(select,trigger);
        select.dataset.appSelectReady = '1';
        const controller = {select,shell,trigger,label,baseStyle,observer:null};
        controllers.set(select,controller);
        controller.observer = new MutationObserver(() => sync(controller));
        controller.observer.observe(select,{subtree:true,childList:true,attributes:true,characterData:true});
        trigger.addEventListener('click',() => open(controller));
        trigger.addEventListener('keydown',event => {
            if(['ArrowDown','ArrowUp','Enter',' '].includes(event.key)){
                event.preventDefault();
                open(controller);
            }
        });
        select.addEventListener('change',() => sync(controller));
        select.addEventListener('input',() => sync(controller));
        select.addEventListener('focus',() => trigger.focus({preventScroll:true}));
        sync(controller);
    }
    function scan(root=document){
        if(root instanceof HTMLSelectElement) enhance(root);
        root.querySelectorAll?.('select').forEach(enhance);
    }
    menu.addEventListener('click',event => {
        const option = event.target.closest('.app-select-option');
        if(option && !option.disabled) choose(option.dataset.value || '');
    });
    menu.addEventListener('keydown',event => {
        const options = [...menu.querySelectorAll('.app-select-option:not(:disabled)')];
        const index = options.indexOf(document.activeElement);
        if(event.key === 'Escape'){ event.preventDefault(); close(); }
        else if(event.key === 'ArrowDown'){ event.preventDefault(); focusOption(index + 1); }
        else if(event.key === 'ArrowUp'){ event.preventDefault(); focusOption(index <= 0 ? options.length - 1 : index - 1); }
        else if(event.key === 'Home'){ event.preventDefault(); focusOption(0); }
        else if(event.key === 'End'){ event.preventDefault(); focusOption(options.length - 1); }
        else if((event.key === 'Enter' || event.key === ' ') && document.activeElement?.classList.contains('app-select-option')){
            event.preventDefault(); choose(document.activeElement.dataset.value || '');
        }
    });
    document.addEventListener('pointerdown',event => {
        if(active && !active.shell.contains(event.target) && !menu.contains(event.target)) close({focus:false});
    },true);
    document.addEventListener('scroll',event => {
        if(active && !menu.contains(event.target)) close({focus:false});
    },true);
    window.addEventListener('resize',() => {
        controllers.forEach(sync);
        if(active) positionMenu(active);
    });
    const domObserver = new MutationObserver(records => records.forEach(record => record.addedNodes.forEach(node => {
        if(node.nodeType === 1) scan(node);
    })));
    function start(){
        document.body.appendChild(menu);
        scan();
        domObserver.observe(document.body,{subtree:true,childList:true});
    }
    if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded',start,{once:true}); else start();
    window.AppSelect = {enhance,scan,syncAll:() => controllers.forEach(sync),close};
})();
