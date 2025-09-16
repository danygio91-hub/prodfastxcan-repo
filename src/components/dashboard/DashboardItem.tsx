
"use client";

import React from 'react';
import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ArrowRight } from 'lucide-react';
import { cn } from "@/lib/utils";

// --- Type Definitions for Polymorphic Component ---

type BaseProps = {
  title: string;
  description: string;
  icon: React.ElementType;
  className?: string;
};

// Props when the component should act as a link
type LinkProps = BaseProps & {
  href: string;
  onClick?: never;
} & Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, 'href'>;

// Props when the component should act as a clickable div
type DivProps = BaseProps & {
  href?: never;
  onClick: React.MouseEventHandler<HTMLDivElement>;
} & React.HTMLAttributes<HTMLDivElement>;

// Props for a non-interactive card
type StaticDivProps = BaseProps & {
    href?: never;
    onClick?: never;
} & React.HTMLAttributes<HTMLDivElement>;


type DashboardItemProps = LinkProps | DivProps | StaticDivProps;


const DashboardItem = React.forwardRef<HTMLDivElement | HTMLAnchorElement, DashboardItemProps>(
  ({ title, description, icon: Icon, className, ...props }, ref) => {

    const isInteractive = 'href' in props || 'onClick' in props;

    const cardClasses = cn(
        "hover:shadow-lg hover:border-primary/50 transition-shadow,border-color duration-300 group flex flex-col h-full",
        { 'cursor-pointer': isInteractive },
        className
    );

    const cardContent = (
        <Card className={cardClasses}>
            <CardHeader>
                <div className="flex justify-between items-start">
                    <Icon className="h-10 w-10 text-primary mb-4" />
                    {isInteractive && (
                      <div className="text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity">
                          <ArrowRight className="h-5 w-5" />
                      </div>
                    )}
                </div>
            </CardHeader>
            <CardContent className="flex-grow">
                <CardTitle className="text-xl font-headline mb-2">{title}</CardTitle>
                <CardDescription>{description}</CardDescription>
            </CardContent>
        </Card>
    );

    if ('href' in props) {
      return (
        <Link href={props.href} passHref legacyBehavior>
          <a ref={ref as React.Ref<HTMLAnchorElement>} {...props}>
             {cardContent}
          </a>
        </Link>
      );
    }
    
    return (
      <div ref={ref as React.Ref<HTMLDivElement>} {...props}>
        {cardContent}
      </div>
    );
  }
);

DashboardItem.displayName = 'DashboardItem';

export default DashboardItem;
