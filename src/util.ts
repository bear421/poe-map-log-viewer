export function createElementFromHTML(html: string): HTMLElement {
    const template = document.createElement('template');
    template.innerHTML = html.trim();
    return template.content.firstElementChild as HTMLElement;
}

export function checkContiguous<T>(array: T[], extractValue: (t: T) => number): void {
    for (let i = 0; i < array.length - 1; i++) {
        const value = extractValue(array[i]);
        const nextValue = extractValue(array[i + 1]);
        if (value > nextValue) {
            console.error(`array[${i}] is not contiguous: ${value} > ${nextValue}`, array[i], array[i + 1]);
            throw new Error(`array[${i}] is not contiguous: ${value} > ${nextValue}`);
        }
    }
}