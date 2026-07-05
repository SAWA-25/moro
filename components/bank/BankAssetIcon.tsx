import React from 'react';
import { isBankPixelRef, resolveBankPixelSrc } from './bankPixelArt';

export const isBankAssetUrl = (value?: string | null): value is string =>
    typeof value === 'string' && (
        value.startsWith('http://') ||
        value.startsWith('https://') ||
        value.startsWith('data:') ||
        value.startsWith('/') ||
        isBankPixelRef(value)
    );

interface BankAssetIconProps {
    value?: string | null;
    alt?: string;
    imgClassName: string;
    textClassName: string;
}

const BankAssetIcon: React.FC<BankAssetIconProps> = ({
    value,
    alt = '',
    imgClassName,
    textClassName,
}) => {
    if (!value) return null;

    const pixelSrc = resolveBankPixelSrc(value);
    if (pixelSrc) return <img src={pixelSrc} alt={alt} className={imgClassName} draggable={false} style={{ imageRendering: 'pixelated' }} />;

    if (isBankAssetUrl(value)) {
        return <img src={value} alt={alt} className={imgClassName} draggable={false} />;
    }

    return <span className={textClassName}>{value}</span>;
};

export default BankAssetIcon;
