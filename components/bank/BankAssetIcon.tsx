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
    onError?: React.ReactEventHandler<HTMLImageElement>;
}

const BankAssetIcon: React.FC<BankAssetIconProps> = ({
    value,
    alt = '',
    imgClassName,
    textClassName,
    onError,
}) => {
    if (!value) return null;

    const pixelSrc = resolveBankPixelSrc(value);
    if (pixelSrc) return <img src={pixelSrc} alt={alt} className={imgClassName} draggable={false} style={{ imageRendering: 'pixelated' }} onError={onError} />;

    if (isBankAssetUrl(value)) {
        return <img src={value} alt={alt} className={imgClassName} draggable={false} onError={onError} />;
    }

    return <span className={textClassName}>{value}</span>;
};

export default BankAssetIcon;
