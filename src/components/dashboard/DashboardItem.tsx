
"use client";

import React from 'react';
import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ArrowRight } from 'lucide-react';
import { cn } from "@/lib/utils";

// --- Type Definitions for Polymorphic Component ---

type DashboardItemProps = {
  title: string;
  description: string;
  icon: React.ElementType;
  className?: string;
  href?: string;
  onClick?: React.MouseEventHandler<HTMLDivElement>;
  disabled?: boolean;
} & (React.HTMLAttributes<HTMLDivElement> | React.AnchorHTMLAttributes<HTMLAnchorElement>);


const DashboardItem = React.forwardRef<HTMLDivElement | HTMLAnchorElement, DashboardItemProps>(
  ({ title, description, icon: Icon, className, href, disabled, ...props }, ref) => {

    const isInteractive = !disabled && (!!href || !!props.onClick);

    const cardClasses = cn(
        "hover:shadow-lg transition-shadow,border-color duration-300 group flex flex-col h-full",
        { 
          'cursor-pointer hover:border-primary/50': isInteractive,
          'opacity-50 cursor-not-allowed': disabled,
        },
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

    if (href && !disabled) {
      return (
        <Link href={href} passHref legacyBehavior>
          <a ref={ref as React.Ref<HTMLAnchorElement>} {...(props as React.AnchorHTMLAttributes<HTMLAnchorElement>)}>
             {cardContent}
          </a>
        </Link>
      );
    }
    
    return (
      <div ref={ref as React.Ref<HTMLDivElement>} {...(props as React.HTMLAttributes<HTMLDivElement>)}>
        {cardContent}
      </div>
    );
  }
);

DashboardItem.displayName = 'DashboardItem';

export default DashboardItem;
